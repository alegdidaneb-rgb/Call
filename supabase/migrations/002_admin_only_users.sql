-- ---------------------------------------------------------------------------
-- 002: admin-only user provisioning
--
-- Public self-service signup is removed. Only an administrator may create an
-- account, through the `admin-users` edge function, which holds the service
-- role key server-side.
--
-- This project's Supabase instance is shared with another application, so the
-- global `disable_signup` auth flag cannot be used: turning it off would break
-- that application's signup as well. Instead the guarantee is enforced here, in
-- the data layer, which the shared auth config cannot override.
--
-- The mechanism is `profiles.invited_by`. An account is *provisioned* when an
-- administrator has onboarded it (or when it holds a privileged role). Every
-- policy that grants an ordinary agent access to data now also requires the
-- caller to be provisioned. An account created by calling `auth.signUp()`
-- directly with the public anon key therefore authenticates successfully but
-- can read and write nothing at all -- it is inert until an admin adopts it.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists invited_by uuid references auth.users(id) on delete set null;

create index if not exists profiles_invited_by_idx on public.profiles (invited_by);

comment on column public.profiles.invited_by is
  'The administrator who onboarded this account. NULL means the account was never provisioned and has no data access.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

/**
 * True when the current request carries the service role key.
 *
 * Needed because RLS is not the only gate: `service_role` has BYPASSRLS, but
 * triggers still fire on its writes. Without this, the provisioning update
 * performed by the edge function would be reverted by `protect_profile_fields`.
 * Handles both the legacy per-claim GUC and the newer JSON claims GUC.
 */
create or replace function public.is_service_role()
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  legacy_role text;
  claims text;
begin
  legacy_role := current_setting('request.jwt.claim.role', true);
  if legacy_role = 'service_role' then
    return true;
  end if;

  claims := current_setting('request.jwt.claims', true);
  if claims is not null and claims <> '' then
    begin
      return (claims::jsonb ->> 'role') = 'service_role';
    exception when others then
      return false;
    end;
  end if;

  return false;
end;
$$;

revoke all on function public.is_service_role() from public, anon;
grant execute on function public.is_service_role() to authenticated, service_role;

/**
 * True when the caller has been onboarded by an administrator, or holds a
 * privileged role. This is the gate applied to every agent-facing policy.
 */
create or replace function public.is_provisioned()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role in ('admin', 'manager') or p.invited_by is not null)
  );
$$;

revoke all on function public.is_provisioned() from public, anon;
grant execute on function public.is_provisioned() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

/**
 * New auth users are always created inert.
 *
 * The previous revision promoted the very first account to `admin` on insert.
 * That was a race: whoever reached `auth.signUp()` first on an empty database
 * became an administrator, with no administrator having approved it. The
 * bootstrap is now an explicit, server-side action in the `admin-users` edge
 * function, which checks the table is empty while holding the service role.
 */
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, invited_by)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'agent',
    null
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

/**
 * Blocks privilege escalation.
 *
 * `role` and `invited_by` are both privilege-bearing columns, so neither may be
 * changed by the account's own owner -- only by an admin, or by the service role
 * acting on an admin's behalf inside the edge function. `invited_by` must also
 * not be clearable, or a provisioned agent could not be suspended by removing
 * their access.
 */
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  may_change_privileges boolean;
begin
  new.id := old.id;
  may_change_privileges := public.is_admin() or public.is_service_role();

  if new.role is distinct from old.role and not may_change_privileges then
    new.role := old.role;
  end if;

  if new.invited_by is distinct from old.invited_by and not may_change_privileges then
    new.invited_by := old.invited_by;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_protect on public.profiles;
create trigger trg_profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- ---------------------------------------------------------------------------
-- Policies: gate every agent-facing rule on is_provisioned().
--
-- Privileged callers are provisioned by definition, so admins and managers are
-- unaffected. Delete policies are already scoped to a user's own rows or to a
-- privileged caller, and an inert account owns no rows, so they need no change.
-- ---------------------------------------------------------------------------

drop policy if exists "campaigns_select_authenticated" on public.campaigns;
create policy "campaigns_select_authenticated" on public.campaigns
  for select to authenticated
  using (public.is_provisioned());

drop policy if exists "campaigns_insert_authenticated" on public.campaigns;
create policy "campaigns_insert_authenticated" on public.campaigns
  for insert to authenticated
  with check (public.is_provisioned());

drop policy if exists "campaigns_update_creator_or_privileged" on public.campaigns;
create policy "campaigns_update_creator_or_privileged" on public.campaigns
  for update to authenticated
  using (public.is_provisioned() and (created_by = auth.uid() or public.is_privileged()))
  with check (public.is_provisioned() and (created_by = auth.uid() or public.is_privileged()));

drop policy if exists "leads_select_scoped" on public.leads;
create policy "leads_select_scoped" on public.leads
  for select to authenticated
  using (
    public.is_provisioned()
    and (
      public.is_privileged()
      or assigned_to = auth.uid()
      or created_by = auth.uid()
      or assigned_to is null
    )
  );

drop policy if exists "leads_insert_authenticated" on public.leads;
create policy "leads_insert_authenticated" on public.leads
  for insert to authenticated
  with check (public.is_provisioned());

drop policy if exists "leads_update_scoped" on public.leads;
create policy "leads_update_scoped" on public.leads
  for update to authenticated
  using (
    public.is_provisioned()
    and (
      public.is_privileged()
      or assigned_to = auth.uid()
      or created_by = auth.uid()
      or assigned_to is null
    )
  )
  with check (
    public.is_provisioned()
    and (
      public.is_privileged()
      or assigned_to = auth.uid()
      or created_by = auth.uid()
      or assigned_to is null
    )
  );

drop policy if exists "call_scripts_select_authenticated" on public.call_scripts;
create policy "call_scripts_select_authenticated" on public.call_scripts
  for select to authenticated
  using (public.is_provisioned());

drop policy if exists "call_scripts_insert_authenticated" on public.call_scripts;
create policy "call_scripts_insert_authenticated" on public.call_scripts
  for insert to authenticated
  with check (public.is_provisioned());

drop policy if exists "call_scripts_update_creator_or_privileged" on public.call_scripts;
create policy "call_scripts_update_creator_or_privileged" on public.call_scripts
  for update to authenticated
  using (public.is_provisioned() and (created_by = auth.uid() or public.is_privileged()))
  with check (public.is_provisioned() and (created_by = auth.uid() or public.is_privileged()));

drop policy if exists "call_logs_select_own_or_privileged" on public.call_logs;
create policy "call_logs_select_own_or_privileged" on public.call_logs
  for select to authenticated
  using (public.is_provisioned() and (user_id = auth.uid() or public.is_privileged()));

drop policy if exists "call_logs_insert_authenticated" on public.call_logs;
create policy "call_logs_insert_authenticated" on public.call_logs
  for insert to authenticated
  with check (public.is_provisioned());

drop policy if exists "call_logs_update_own_or_privileged" on public.call_logs;
create policy "call_logs_update_own_or_privileged" on public.call_logs
  for update to authenticated
  using (public.is_provisioned() and (user_id = auth.uid() or public.is_privileged()))
  with check (public.is_provisioned() and (user_id = auth.uid() or public.is_privileged()));

drop policy if exists "appointments_select_own_or_privileged" on public.appointments;
create policy "appointments_select_own_or_privileged" on public.appointments
  for select to authenticated
  using (public.is_provisioned() and (user_id = auth.uid() or public.is_privileged()));

drop policy if exists "appointments_insert_authenticated" on public.appointments;
create policy "appointments_insert_authenticated" on public.appointments
  for insert to authenticated
  with check (public.is_provisioned());

drop policy if exists "appointments_update_own_or_privileged" on public.appointments;
create policy "appointments_update_own_or_privileged" on public.appointments
  for update to authenticated
  using (public.is_provisioned() and (user_id = auth.uid() or public.is_privileged()))
  with check (public.is_provisioned() and (user_id = auth.uid() or public.is_privileged()));

drop policy if exists "dnc_select_authenticated" on public.dnc_list;
create policy "dnc_select_authenticated" on public.dnc_list
  for select to authenticated
  using (public.is_provisioned());

drop policy if exists "dnc_insert_authenticated" on public.dnc_list;
create policy "dnc_insert_authenticated" on public.dnc_list
  for insert to authenticated
  with check (public.is_provisioned());

-- ---------------------------------------------------------------------------
-- Backfill: existing accounts predate this column. Everyone already in the
-- table was created before provisioning was tracked, so adopt them under the
-- first admin rather than locking out a live team. On an empty database this is
-- a no-op and the bootstrap path applies.
-- ---------------------------------------------------------------------------

-- The guard trigger installed above treats `invited_by` as privilege-bearing and
-- reverts changes from anyone who is neither an admin nor the service role. A
-- migration runs as `postgres` with no JWT claims at all, so it is neither: the
-- backfill would be silently undone. Disable the trigger for the duration
-- instead of weakening it.
alter table public.profiles disable trigger trg_profiles_protect;

with first_admin as (
  select id from public.profiles where role = 'admin' order by created_at limit 1
)
update public.profiles p
set invited_by = fa.id
from first_admin fa
where p.invited_by is null
  and p.id <> fa.id;

update public.profiles
set invited_by = id
where role in ('admin', 'manager') and invited_by is null;

alter table public.profiles enable trigger trg_profiles_protect;
