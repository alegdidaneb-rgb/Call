/**
 * 006 — TURN relays, and Bitcall as a named provider.
 *
 * A browser can only carry SIP over WebSocket, and its audio over WebRTC. STUN
 * tells that browser its own public address, which is enough for an agent on a
 * home or office network. It cannot help when both ends sit behind a symmetric
 * NAT, or when a firewall drops inbound UDP: the addresses the two browsers
 * exchange are unreachable, the call still establishes, and there is no audio in
 * one or both directions.
 *
 * That failure is worth a migration because nothing else in the app can see it.
 * Registration succeeds, the call connects, the call log records an answered call
 * with a real duration, and the only symptom is two people who cannot hear each
 * other. A TURN relay carries the media instead of the two endpoints reaching each
 * other directly, and it is the only thing that fixes the case. `sip_accounts`
 * could not hold one, so an operator had no way to configure it.
 *
 * The credential is stored in plaintext, as `password` already is: the browser has
 * to send it to the relay to allocate a port, so hashing it would only produce a
 * relay that refuses the allocation. Reads stay restricted by the row-level
 * security in 004, and SECURITY.md records it as a residual. The mitigation is the
 * shape of the credential itself — a coturn user that can allocate relays and
 * nothing else, not a shared secret with any other use.
 *
 * The ported backend in `backend/` stores these as a JSON array in a `text` column
 * rather than as `text[]`, matching what it already does for `stun_urls` so that
 * both deployments run identical route code. The constraint below is written
 * against the real array type this schema uses.
 */

alter table public.sip_accounts
  add column if not exists turn_urls text[] not null default '{}',
  add column if not exists turn_username text,
  add column if not exists turn_credential text;

comment on column public.sip_accounts.turn_urls is
  'TURN relays, e.g. turn:host:3478 or turns:host:5349?transport=tcp. Empty means no relay, which is valid for agents on open networks.';
comment on column public.sip_accounts.turn_username is
  'Relay username. Required together with turn_credential and with at least one turn_urls entry.';
comment on column public.sip_accounts.turn_credential is
  'Relay credential, in plaintext because the browser must send it. Reads are restricted by row-level security.';

/**
 * Constraints are added in a block because `alter table ... add constraint` has no
 * `if not exists`, and every other statement in these migrations is idempotent. A
 * migration that fails the second time it runs is a migration that cannot be
 * retried after a partial failure.
 */
do $$
declare
  tbl regclass := 'public.sip_accounts'::regclass;
begin
  /**
   * The provider list gains `bitcall`.
   *
   * Bitcall publishes SIP on gateway.bitcall.io:5060/udp only, which a browser
   * cannot send, so the preset in the app is marked as needing a gateway and points
   * at @bitcall/webrtc-sip-gateway running on a host the operator controls. Naming
   * it here is what lets that preset exist: without it the row cannot be saved, and
   * an operator has to file Bitcall under "Other" with no guidance attached.
   *
   * Replaced only when the stored definition predates it, so a re-run is a no-op.
   */
  if exists (
    select 1 from pg_constraint
    where conrelid = tbl
      and conname = 'sip_accounts_provider_check'
      and pg_get_constraintdef(oid) not like '%bitcall%'
  ) then
    alter table public.sip_accounts drop constraint sip_accounts_provider_check;
  end if;

  if not exists (
    select 1 from pg_constraint where conrelid = tbl and conname = 'sip_accounts_provider_check'
  ) then
    alter table public.sip_accounts
      add constraint sip_accounts_provider_check
      check (provider in ('signalwire', 'telnyx', 'twilio', 'bitcall', 'custom'));
  end if;

  /**
   * Half a relay credential is worse than none.
   *
   * Given servers without a credential, a browser attempts an allocation, is
   * refused, and quietly falls back to a direct path — the same silent-audio failure
   * the relay was added to prevent, now behind a configuration that looks complete.
   * Refusing the row is the only point at which the person who caused it is still
   * looking at the fields.
   */
  if not exists (
    select 1 from pg_constraint
    where conrelid = tbl and conname = 'sip_accounts_turn_credential_pairs'
  ) then
    alter table public.sip_accounts
      add constraint sip_accounts_turn_credential_pairs
      check (
        (turn_username is null and turn_credential is null)
        or (coalesce(btrim(turn_username), '') <> '' and coalesce(btrim(turn_credential), '') <> '')
      );
  end if;

  /**
   * A credential with no server to use it on.
   *
   * `turn_username is null` rather than a test on `turn_credential`: the two are
   * already tied together above, so either can stand for "no relay configured", and
   * testing both would be a second copy of the same rule.
   */
  if not exists (
    select 1 from pg_constraint
    where conrelid = tbl and conname = 'sip_accounts_turn_needs_server'
  ) then
    alter table public.sip_accounts
      add constraint sip_accounts_turn_needs_server
      check (turn_username is null or cardinality(turn_urls) > 0);
  end if;
end
$$;
