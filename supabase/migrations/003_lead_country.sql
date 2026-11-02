-- ---------------------------------------------------------------------------
-- 003: international leads
--
-- `leads` had no country column and the form hardcoded a single "+1 (US)"
-- dialling option, so every lead was implicitly American. This adds an ISO
-- 3166-1 alpha-2 `country` and derives the dialling prefix from it.
--
-- Existing rows are deliberately left NULL rather than backfilled from the phone
-- prefix. Dialling codes are shared -- "+1" covers 26 countries and "+7" both
-- Russia and Kazakhstan -- so a backfill would write guesses into a compliance
-- field. The UI infers a country from the number when it is unambiguous and
-- otherwise leaves the choice to the user.
-- ---------------------------------------------------------------------------

alter table public.leads
  add column if not exists country text;

-- Postgres has no `add constraint if not exists`, so drop first.
alter table public.leads
  drop constraint if exists leads_country_iso_alpha2;

alter table public.leads
  add constraint leads_country_iso_alpha2
  check (country is null or country ~ '^[A-Z]{2}$');

create index if not exists leads_country_idx on public.leads (country);

comment on column public.leads.country is
  'ISO 3166-1 alpha-2 code. The dialling prefix is derived from this in the UI; `phone` is still stored in international format.';

/**
 * Accepts the formats a CSV import or a hand-typed form is likely to produce
 * ("us", " US ", "") and normalises them before the check constraint runs, so a
 * lowercase code is stored correctly instead of rejected.
 */
create or replace function public.normalize_lead_country()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.country is not null then
    new.country := upper(btrim(new.country));
    if new.country = '' then
      new.country := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_leads_country on public.leads;
create trigger trg_leads_country
  before insert or update of country on public.leads
  for each row execute function public.normalize_lead_country();
