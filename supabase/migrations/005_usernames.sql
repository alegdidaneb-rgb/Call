/**
 * 005 — Usernames.
 *
 * Accounts are created by an administrator and signed into with a username.
 * Email stops being something anybody types.
 *
 * Supabase Auth has no username identity: `auth.admin.createUser` requires an
 * email or a phone, and `profiles.email` is `not null unique`. Rather than
 * rewrite `auth.users.email` — which would also mean surgery on
 * `auth.identities`, on the only administrator this deployment has, with no
 * recovery path if it went wrong — the email stays as the internal identity and
 * a username is layered on top of it:
 *
 *   - New accounts are created with a synthetic address,
 *     `<username>@agents.cold-dialer.internal`, which is never delivered to and
 *     never shown.
 *   - Existing accounts keep the address they already have, so nobody is locked
 *     out by this migration.
 *   - Sign-in resolves a username to its login address through
 *     `public.resolve_login_email`, one path for both kinds of account.
 *
 * The consequence is that an unauthenticated caller can confirm a username
 * exists. That trade is recorded in SECURITY.md; it was judged preferable to
 * mutating auth internals on an account that cannot be recovered.
 */

-- ---------------------------------------------------------------------------
-- Reserved names. Kept in a function so the check constraint, the derivation
-- helper and the backfill cannot disagree about the list.
-- ---------------------------------------------------------------------------

create or replace function public.reserved_usernames()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'admin', 'administrator', 'root', 'system', 'setup', 'support', 'help',
    'noreply', 'no-reply', 'postmaster', 'webmaster', 'abuse', 'security',
    'everyone', 'all', 'null', 'undefined', 'unknown', 'test', 'guest'
  ];
$$;

-- ---------------------------------------------------------------------------
-- Derive a username from an email address, avoiding collisions.
--
-- Used for accounts that arrive without one, and by the backfill below. A
-- username an administrator explicitly chose is *not* passed through this: it is
-- stored verbatim so that a collision fails loudly instead of silently creating
-- `marco2` when the administrator asked for `marco`.
-- ---------------------------------------------------------------------------

create or replace function public.derive_username(p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  base text;
  candidate text;
  n integer := 1;
begin
  base := lower(split_part(coalesce(p_email, ''), '@', 1));
  base := regexp_replace(base, '[^a-z0-9._-]', '', 'g');
  base := btrim(base, '._-');

  if char_length(base) < 3 or base = any (public.reserved_usernames()) then
    base := 'user';
  end if;
  if char_length(base) > 30 then
    base := left(base, 30);
  end if;

  candidate := base;
  while exists (
    select 1 from public.profiles p where lower(p.username) = lower(candidate)
  ) loop
    n := n + 1;
    candidate := base || n::text;
  end loop;

  return candidate;
end;
$$;

revoke all on function public.derive_username(text) from public;
grant execute on function public.derive_username(text) to authenticated;

-- ---------------------------------------------------------------------------
-- The column. Nullable while it is backfilled; the not-null constraint comes
-- after, so a partially migrated table cannot reject a sign-in.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists username text;

comment on column public.profiles.username is
  'How the account signs in. Case-insensitively unique. The email column stays as the Supabase Auth identity and is synthetic for accounts created after migration 005.';

-- ---------------------------------------------------------------------------
-- Backfill.
--
-- This runs BEFORE `protect_profile_fields()` is extended to pin `username`.
-- That ordering is load-bearing: the trigger reverts any column it protects to
-- its old value unless the caller is an administrator or holds the service role,
-- and a migration runs with neither `auth.uid()` nor any JWT claims, so
-- installing the trigger first would silently undo every row updated here.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select id, email
    from public.profiles
    where username is null
    order by created_at nulls last, id
  loop
    update public.profiles
    set username = public.derive_username(r.email)
    where id = r.id;
  end loop;
end;
$$;

alter table public.profiles
  alter column username set not null;

-- Case-insensitive: `Marco` and `marco` must not be two accounts, or an
-- administrator cannot tell which one they are editing.
create unique index if not exists profiles_username_key
  on public.profiles (lower(username));

alter table public.profiles
  drop constraint if exists profiles_username_shape,
  add constraint profiles_username_shape check (
    char_length(username) between 3 and 32
    and username ~ '^[a-z0-9][a-z0-9._-]*[a-z0-9]$'
    and lower(username) <> all (public.reserved_usernames())
  );

-- ---------------------------------------------------------------------------
-- Resolve a username to the address Supabase Auth knows it by.
--
-- `security definer` because an unauthenticated caller has no row-level access
-- to `profiles` at all, and sign-in has to happen before there is a session.
-- It returns one column and nothing else: no role, no name, no existence of any
-- other account.
-- ---------------------------------------------------------------------------

create or replace function public.resolve_login_email(p_username text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.email
  from public.profiles p
  where lower(p.username) = lower(btrim(coalesce(p_username, '')))
  limit 1;
$$;

revoke all on function public.resolve_login_email(text) from public;
grant execute on function public.resolve_login_email(text) to anon, authenticated;

comment on function public.resolve_login_email(text) is
  'Sign-in helper: maps a username to the email address that is the Supabase Auth identity. Deliberately returns nothing else. Exposed to anon, which makes usernames enumerable; see SECURITY.md.';

-- ---------------------------------------------------------------------------
-- New accounts get a username at insert time.
--
-- `on_auth_user_created` fires on every `auth.admin.createUser`, so this is the
-- one place a profile can come into existence. An administrator-chosen username
-- arrives in `raw_user_meta_data` and is stored verbatim — if it collides, the
-- insert fails and the caller is told the username is taken, which is better
-- than quietly creating somebody else.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
begin
  v_username := nullif(new.raw_user_meta_data ->> 'username', '');

  insert into public.profiles (id, email, username, full_name, role, invited_by)
  values (
    new.id,
    new.email,
    coalesce(v_username, public.derive_username(new.email)),
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

-- ---------------------------------------------------------------------------
-- A username is an identity, so it joins the privilege-bearing columns.
--
-- Without this an agent could rename themselves to a colleague's username, and
-- the unique index would then decide which of them keeps it.
--
-- This EXTENDS the 002 definition; it does not replace its semantics. Two things
-- in it are load-bearing and must survive any future edit:
--
--   * `may_change_privileges` includes `public.is_service_role()`. `service_role`
--     has BYPASSRLS but triggers still fire on its writes, so the `admin-users`
--     edge function's provisioning UPDATE needs this allowance — without it every
--     account it creates comes back as an inert agent.
--   * `invited_by` is protected too, because it is what `is_provisioned()` reads.
--     An agent who could set it would grant themselves access.
--
-- A regression here fails silently: the trigger reverts the column instead of
-- raising, so the write reports success.
-- ---------------------------------------------------------------------------

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

  if new.username is distinct from old.username and not may_change_privileges then
    new.username := old.username;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_protect on public.profiles;
create trigger trg_profiles_protect
  before update on public.profiles
  for each row execute function public.protect_profile_fields();
