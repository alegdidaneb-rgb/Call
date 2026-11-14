-- Web SIP phone credentials.
--
-- A browser softphone authenticates to the SIP server itself (digest auth over
-- WSS), so the password has to reach the client. There is no way around that in
-- this architecture; what we can control is who may read it. Every agent should
-- get their own extension so that one leaked credential cannot be used to place
-- calls on the whole trunk, and so a provider-side block can be applied to one
-- extension instead of shutting down the campaign.
--
-- A row with user_id IS NULL is the shared trunk default, used by anyone who has
-- no account of their own.

create table if not exists public.sip_accounts (
  id uuid primary key default gen_random_uuid(),
  -- NULL means "shared trunk default" rather than "unowned".
  user_id uuid references auth.users(id) on delete cascade,
  label text,
  provider text not null default 'custom'
    check (provider in ('signalwire', 'telnyx', 'twilio', 'custom')),
  -- Address of record, e.g. sip:1001@pbx.example.com
  sip_uri text not null,
  -- Stored in cleartext because the browser needs the cleartext value to answer
  -- the SIP digest challenge. Reads are restricted by RLS below.
  password text not null,
  -- WebSocket endpoint, must be wss:// when the app is served over https.
  ws_url text not null,
  caller_id text,
  stun_urls text[] not null default array['stun:stun.l.google.com:19302'],
  register_expiry integer not null default 600
    check (register_expiry between 60 and 3600),
  enabled boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (user_id)
);

-- unique(user_id) does not constrain NULLs in Postgres, so the trunk default
-- needs its own guard: without it a second enabled default would make the
-- "which account do I dial from?" lookup non-deterministic.
create unique index if not exists sip_accounts_single_trunk_default
  on public.sip_accounts ((true))
  where user_id is null;

create index if not exists sip_accounts_user_idx
  on public.sip_accounts (user_id)
  where user_id is not null;

drop trigger if exists trg_sip_accounts_updated_at on public.sip_accounts;
create trigger trg_sip_accounts_updated_at before update on public.sip_accounts
  for each row execute function public.set_updated_at();

comment on table public.sip_accounts is
  'SIP credentials for the browser softphone. user_id IS NULL is the shared trunk default.';
comment on column public.sip_accounts.password is
  'Cleartext by necessity: the browser performs SIP digest authentication. Reads are restricted to the owner and to admins.';

alter table public.sip_accounts enable row level security;

-- An agent may read their own credentials and the shared trunk default, but only
-- once an administrator has provisioned them. Unprovisioned accounts can
-- authenticate yet must see nothing at all, matching the rest of the schema.
drop policy if exists "sip_accounts_select_own_or_trunk" on public.sip_accounts;
create policy "sip_accounts_select_own_or_trunk" on public.sip_accounts
  for select to authenticated
  using (
    public.is_provisioned()
    and (public.is_admin() or user_id = auth.uid() or user_id is null)
  );

-- Only administrators may add, change or remove credentials. An agent able to
-- edit their own row could point the softphone at a server they control.
drop policy if exists "sip_accounts_write_admin" on public.sip_accounts;
create policy "sip_accounts_write_admin" on public.sip_accounts
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.sip_accounts from public, anon;
grant select, insert, update, delete on public.sip_accounts to authenticated, service_role;
