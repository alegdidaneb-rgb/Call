-- Open Cold Dialer - initial schema and row level security.
--
-- IMPORTANT: an earlier revision of this file created ~12 RLS policies but never
-- ran `alter table ... enable row level security`. Policies attached to a table
-- with RLS disabled are inert, so any holder of the anon key had unrestricted
-- read/write access to every row. RLS is now enabled on every table below, and
-- the policies scope rows per user rather than exposing the whole tenant.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role text not null default 'agent' check (role in ('admin', 'agent', 'manager')),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'outbound' check (type in ('outbound', 'inbound', 'blended')),
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  settings jsonb,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  first_name text,
  last_name text,
  company text,
  phone text,
  email text,
  website text,
  address text,
  city text,
  state text,
  zip text,
  status text not null default 'new' check (status in ('new', 'contacted', 'interested', 'not_interested', 'callback', 'converted', 'do_not_contact')),
  source text,
  campaign_id uuid references public.campaigns(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  tags text[],
  notes text,
  dnc boolean not null default false,
  last_called_at timestamp with time zone,
  call_count int not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.call_scripts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text,
  content text,
  objection_responses jsonb,
  campaign_id uuid references public.campaigns(id) on delete set null,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.call_logs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  user_id uuid default auth.uid() references public.profiles(id) on delete set null,
  campaign_id uuid references public.campaigns(id) on delete set null,
  direction text not null default 'outbound' check (direction in ('outbound', 'inbound')),
  outcome text not null check (outcome in ('no_answer', 'answered', 'busy', 'voicemail', 'dnc', 'wrong_number', 'disconnected')),
  duration_seconds int not null default 0,
  recording_url text,
  notes text,
  transcript text,
  sip_call_id text,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  scheduled_at timestamp with time zone not null,
  duration_minutes int not null default 30,
  type text not null check (type in ('sales_call', 'demo', 'follow_up', 'consultation', 'check_in')),
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled', 'rescheduled')),
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.dnc_list (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  reason text,
  source text,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_leads_status on public.leads(status);
create index if not exists idx_leads_phone on public.leads(phone);
create index if not exists idx_leads_campaign on public.leads(campaign_id);
create index if not exists idx_leads_assigned on public.leads(assigned_to);
create index if not exists idx_leads_created_by on public.leads(created_by);
create index if not exists idx_call_logs_lead on public.call_logs(lead_id);
create index if not exists idx_call_logs_user on public.call_logs(user_id);
create index if not exists idx_call_logs_created_at on public.call_logs(created_at desc);
create index if not exists idx_appointments_lead on public.appointments(lead_id);
create index if not exists idx_appointments_user on public.appointments(user_id);
create index if not exists idx_dnc_phone on public.dnc_list(phone);

-- ---------------------------------------------------------------------------
-- Authorisation helpers
--
-- security definer + a pinned search_path lets policies consult `profiles`
-- without recursing into the policies on `profiles` itself.
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_privileged()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'manager')
  );
$$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_privileged() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.is_privileged() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_campaigns_updated_at on public.campaigns;
create trigger trg_campaigns_updated_at before update on public.campaigns
  for each row execute function public.set_updated_at();

drop trigger if exists trg_leads_updated_at on public.leads;
create trigger trg_leads_updated_at before update on public.leads
  for each row execute function public.set_updated_at();

drop trigger if exists trg_call_scripts_updated_at on public.call_scripts;
create trigger trg_call_scripts_updated_at before update on public.call_scripts
  for each row execute function public.set_updated_at();

drop trigger if exists trg_appointments_updated_at on public.appointments;
create trigger trg_appointments_updated_at before update on public.appointments
  for each row execute function public.set_updated_at();

/**
 * Blocks privilege escalation: a non-admin editing their own profile cannot
 * change `role`, and nobody can rewrite a primary key out from under the
 * foreign keys that point at it.
 */
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.id := old.id;
  if new.role is distinct from old.role and not public.is_admin() then
    new.role := old.role;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_protect on public.profiles;
create trigger trg_profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_fields();

/**
 * Call logs are attributed to the caller. The UI sends `user_id: null`, and a
 * client must not be able to attribute a log to somebody else, so the value is
 * normalised here. Admins and managers may still record on another user's
 * behalf.
 */
create or replace function public.normalize_call_log_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is null or not public.is_privileged() then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_call_logs_owner on public.call_logs;
create trigger trg_call_logs_owner before insert on public.call_logs
  for each row execute function public.normalize_call_log_owner();

/** `created_by` is always the inserting user; it is not client-supplied. */
create or replace function public.normalize_created_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_leads_created_by on public.leads;
create trigger trg_leads_created_by before insert on public.leads
  for each row execute function public.normalize_created_by();

drop trigger if exists trg_campaigns_created_by on public.campaigns;
create trigger trg_campaigns_created_by before insert on public.campaigns
  for each row execute function public.normalize_created_by();

drop trigger if exists trg_call_scripts_created_by on public.call_scripts;
create trigger trg_call_scripts_created_by before insert on public.call_scripts
  for each row execute function public.normalize_created_by();

-- ---------------------------------------------------------------------------
-- Enable row level security
--
-- This is the step the previous revision omitted entirely.
-- ---------------------------------------------------------------------------

alter table public.profiles    enable row level security;
alter table public.campaigns   enable row level security;
alter table public.leads       enable row level security;
alter table public.call_scripts enable row level security;
alter table public.call_logs   enable row level security;
alter table public.appointments enable row level security;
alter table public.dnc_list    enable row level security;

-- ---------------------------------------------------------------------------
-- Policies
--
-- Names from the previous revision are dropped first so this file can be
-- re-applied to a database that already ran it.
-- ---------------------------------------------------------------------------

drop policy if exists "Profiles are viewable by authenticated users" on public.profiles;
drop policy if exists "Profiles are updatable by the owner or admin" on public.profiles;
drop policy if exists "Campaigns are viewable by authenticated users" on public.campaigns;
drop policy if exists "Campaigns are insertable by authenticated users" on public.campaigns;
drop policy if exists "Campaigns are updatable by the creator or admin" on public.campaigns;
drop policy if exists "Campaigns are deletable by admin" on public.campaigns;
drop policy if exists "Leads are viewable by authenticated users" on public.leads;
drop policy if exists "Leads are insertable by authenticated users" on public.leads;
drop policy if exists "Leads are updatable by the owner or admin" on public.leads;
drop policy if exists "Call logs are viewable by authenticated users" on public.call_logs;
drop policy if exists "Call logs are insertable by authenticated users" on public.call_logs;
drop policy if exists "Appointments are viewable by authenticated users" on public.appointments;
drop policy if exists "Appointments are insertable by authenticated users" on public.appointments;
drop policy if exists "DNC list is viewable by authenticated users" on public.dnc_list;
drop policy if exists "DNC list is insertable by authenticated users" on public.dnc_list;

-- profiles: your own row only, unless you are an admin. Previously every
-- authenticated user could read every other user's email address.
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_delete_admin" on public.profiles;
create policy "profiles_delete_admin" on public.profiles
  for delete to authenticated
  using (public.is_admin());

-- campaigns: shared team resource, readable by all members.
drop policy if exists "campaigns_select_authenticated" on public.campaigns;
create policy "campaigns_select_authenticated" on public.campaigns
  for select to authenticated
  using (true);

drop policy if exists "campaigns_insert_authenticated" on public.campaigns;
create policy "campaigns_insert_authenticated" on public.campaigns
  for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists "campaigns_update_creator_or_privileged" on public.campaigns;
create policy "campaigns_update_creator_or_privileged" on public.campaigns
  for update to authenticated
  using (created_by = auth.uid() or public.is_privileged())
  with check (created_by = auth.uid() or public.is_privileged());

drop policy if exists "campaigns_delete_admin" on public.campaigns;
create policy "campaigns_delete_admin" on public.campaigns
  for delete to authenticated
  using (public.is_admin());

-- leads: an agent sees their own leads, leads they created, and the unassigned
-- claimable pool. Admins and managers see everything.
drop policy if exists "leads_select_scoped" on public.leads;
create policy "leads_select_scoped" on public.leads
  for select to authenticated
  using (
    public.is_privileged()
    or assigned_to = auth.uid()
    or created_by = auth.uid()
    or assigned_to is null
  );

drop policy if exists "leads_insert_authenticated" on public.leads;
create policy "leads_insert_authenticated" on public.leads
  for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists "leads_update_scoped" on public.leads;
create policy "leads_update_scoped" on public.leads
  for update to authenticated
  using (
    public.is_privileged()
    or assigned_to = auth.uid()
    or created_by = auth.uid()
    or assigned_to is null
  )
  with check (
    public.is_privileged()
    or assigned_to = auth.uid()
    or created_by = auth.uid()
    or assigned_to is null
  );

-- Missing entirely from the previous revision: deletes silently returned zero
-- rows because no delete policy existed.
drop policy if exists "leads_delete_privileged" on public.leads;
create policy "leads_delete_privileged" on public.leads
  for delete to authenticated
  using (public.is_privileged() or created_by = auth.uid());

-- call_scripts: shared team collateral.
drop policy if exists "call_scripts_select_authenticated" on public.call_scripts;
create policy "call_scripts_select_authenticated" on public.call_scripts
  for select to authenticated
  using (true);

drop policy if exists "call_scripts_insert_authenticated" on public.call_scripts;
create policy "call_scripts_insert_authenticated" on public.call_scripts
  for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists "call_scripts_update_creator_or_privileged" on public.call_scripts;
create policy "call_scripts_update_creator_or_privileged" on public.call_scripts
  for update to authenticated
  using (created_by = auth.uid() or public.is_privileged())
  with check (created_by = auth.uid() or public.is_privileged());

drop policy if exists "call_scripts_delete_admin" on public.call_scripts;
create policy "call_scripts_delete_admin" on public.call_scripts
  for delete to authenticated
  using (public.is_admin());

-- call_logs: personal activity records.
drop policy if exists "call_logs_select_own_or_privileged" on public.call_logs;
create policy "call_logs_select_own_or_privileged" on public.call_logs
  for select to authenticated
  using (user_id = auth.uid() or public.is_privileged());

drop policy if exists "call_logs_insert_authenticated" on public.call_logs;
create policy "call_logs_insert_authenticated" on public.call_logs
  for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists "call_logs_update_own_or_privileged" on public.call_logs;
create policy "call_logs_update_own_or_privileged" on public.call_logs
  for update to authenticated
  using (user_id = auth.uid() or public.is_privileged())
  with check (user_id = auth.uid() or public.is_privileged());

drop policy if exists "call_logs_delete_own_or_admin" on public.call_logs;
create policy "call_logs_delete_own_or_admin" on public.call_logs
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- appointments
drop policy if exists "appointments_select_own_or_privileged" on public.appointments;
create policy "appointments_select_own_or_privileged" on public.appointments
  for select to authenticated
  using (user_id = auth.uid() or public.is_privileged());

drop policy if exists "appointments_insert_authenticated" on public.appointments;
create policy "appointments_insert_authenticated" on public.appointments
  for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists "appointments_update_own_or_privileged" on public.appointments;
create policy "appointments_update_own_or_privileged" on public.appointments
  for update to authenticated
  using (user_id = auth.uid() or public.is_privileged())
  with check (user_id = auth.uid() or public.is_privileged());

drop policy if exists "appointments_delete_own_or_admin" on public.appointments;
create policy "appointments_delete_own_or_admin" on public.appointments
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- dnc_list: a do-not-call list is a compliance record and must be visible to
-- everyone who dials, but only admins may remove entries.
drop policy if exists "dnc_select_authenticated" on public.dnc_list;
create policy "dnc_select_authenticated" on public.dnc_list
  for select to authenticated
  using (true);

drop policy if exists "dnc_insert_authenticated" on public.dnc_list;
create policy "dnc_insert_authenticated" on public.dnc_list
  for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists "dnc_delete_admin" on public.dnc_list;
create policy "dnc_delete_admin" on public.dnc_list
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Grants: the anon role gets nothing.
-- ---------------------------------------------------------------------------

revoke all on public.profiles, public.campaigns, public.leads, public.call_scripts,
  public.call_logs, public.appointments, public.dnc_list from anon;

grant select, insert, update, delete on public.profiles, public.campaigns, public.leads,
  public.call_scripts, public.call_logs, public.appointments, public.dnc_list to authenticated;

-- ---------------------------------------------------------------------------
-- Bootstrap a profile for every new auth user.
--
-- The very first account becomes an admin so a fresh deployment is usable;
-- everyone after that is an agent.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  bootstrap_role text;
begin
  select case when count(*) = 0 then 'admin' else 'agent' end
    into bootstrap_role
    from public.profiles;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    bootstrap_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
