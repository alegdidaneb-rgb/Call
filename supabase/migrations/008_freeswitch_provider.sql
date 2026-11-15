/**
 * 008 — FreeSWITCH is a named provider, not something to file under "Other".
 *
 * `sip_accounts.provider` gains `freeswitch`. The column's CHECK constraint is what
 * decides whether a preset the app offers can actually be saved, so the enum exists
 * in the database first and in the form second: adding it here is what lets the
 * frontend preset mean anything.
 *
 * Why FreeSWITCH needs its own entry rather than sharing `custom`:
 *
 * `custom` was labelled "Other (Asterisk, FreeSWITCH, 3CX, ...)" and derives its
 * WebSocket URL from `wsPort: 8089`. That is Asterisk's HTTP/WSS port. FreeSWITCH
 * answers SIP over WebSocket on **7443** — `conf/vanilla/sip_profiles/internal.xml`
 * binds `wss-binding :7443` and `ws-binding :5066`, both uncommented, in the
 * configuration it ships. So an operator who picked "Other" for a FreeSWITCH host
 * and left the WebSocket field blank was pointed at a port with nothing listening,
 * and the failure surfaced as a transport error that said nothing about the port.
 *
 * A preset is the only place that knowledge can live usefully. A doc page explains
 * it to somebody who reads the docs; the derived URL is what the form actually puts
 * in the field.
 *
 * Idempotent in the same shape as migration 006: the constraint is dropped only when
 * the stored definition predates the new value, and re-added only when absent, so a
 * re-run is a no-op rather than an error. A migration that fails the second time it
 * runs cannot be retried after a partial failure.
 */

do $$
declare
  tbl regclass := 'public.sip_accounts'::regclass;
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = tbl
      and conname = 'sip_accounts_provider_check'
      and pg_get_constraintdef(oid) not like '%freeswitch%'
  ) then
    alter table public.sip_accounts drop constraint sip_accounts_provider_check;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = tbl and conname = 'sip_accounts_provider_check'
  ) then
    alter table public.sip_accounts
      add constraint sip_accounts_provider_check
      check (provider in (
        'signalwire', 'telnyx', 'twilio', 'bitcall', 'freeswitch', 'custom'
      ));
  end if;
end
$$;

/**
 * What the stored value means, next to the value.
 *
 * `comment on column` replaces any previous comment, so this is safe to re-run, and
 * it puts the explanation where somebody inspecting the schema will find it rather
 * than only in a migration that has already scrolled past.
 */
comment on column public.sip_accounts.provider is
  'Which SIP provider preset this account was configured from. One of signalwire, '
  'telnyx, twilio, bitcall, freeswitch, custom. The value records intent rather '
  'than restricting behaviour: the fields that actually decide how the browser '
  'connects are sip_uri, ws_url, stun_urls and the turn_* columns. `freeswitch` '
  'exists separately from `custom` because the two derive different WebSocket '
  'ports -- 7443 for FreeSWITCH, 8089 for Asterisk -- and a wrong guess there '
  'fails as an unexplained transport error. See docs/freeswitch-webrtc.md.';
