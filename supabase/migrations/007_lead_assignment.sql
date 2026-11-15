/**
 * 007 — Assignment is an administrator's decision, not a suggestion.
 *
 * `leads.assigned_to` has existed since 001 and the row-level policies have always
 * let an administrator write it. What was missing was any way to *see* or *change*
 * it: no screen offered the control, so in practice nobody assigned anything and
 * every lead sat in the pool that all agents see.
 *
 * Adding the control raises the opposite question. The policies permit an agent to
 * update a lead they created, and `WITH CHECK` passes for such a row on
 * `created_by = auth.uid()` whatever `assigned_to` is set to — so an agent could
 * hand a lead they created to somebody else, or take one back from them. The
 * Express API has never allowed that: `PATCH /api/leads/:id` refuses an
 * `assigned_to` that names anybody but the caller. Production runs against
 * row-level security rather than that API, so the stricter rule existed only in the
 * deployment nobody uses.
 *
 * This makes the database say what the product means. Two acts stay with agents,
 * because both are the agent deciding about their own work rather than somebody
 * else's:
 *
 *   - claiming a lead from the unassigned pool (`null` -> me)
 *   - releasing one of their own leads back into it (me -> `null`)
 *
 * Everything else — naming another person, or moving a lead that is already
 * somebody's — is an administrator's or manager's decision.
 */

/**
 * Refuses an assignment the caller has no business making.
 *
 * Deliberately NOT `security definer`: it has to see the caller's own identity, and
 * `is_privileged()` and `auth.uid()` are already definer functions that read the
 * session for it.
 */
create or replace function public.protect_lead_assignment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  /**
   * Only browser sessions are governed here.
   *
   * The tempting gate is `is_privileged() or is_service_role()`, and it is wrong:
   * `is_service_role()` reads the JWT claims GUC, and a direct server connection
   * has none. The self-hosted Express API connects straight to Postgres, so under
   * that gate `is_privileged()` is false (`auth.uid()` is null) *and*
   * `is_service_role()` is false, and every assignment an administrator made
   * through the API would be refused by a trigger meant to protect against agents.
   *
   * So the rule is applied to the roles PostgREST switches into for a browser
   * request. Anything else — the API's own connection, `service_role` from an edge
   * function — is a server-side caller that has already authorised the request
   * itself, with `requireRole("admin", "manager")` on the route.
   */
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  -- Every other write to a lead — status, notes, call counts, the do-not-contact
  -- flag — passes straight through. This is the only column it guards, and the
  -- workspace updates a lead on every disposition, so the check has to be cheap
  -- and has to stay out of the way.
  if new.assigned_to is not distinct from old.assigned_to then
    return new;
  end if;

  if public.is_privileged() then
    return new;
  end if;

  -- Claiming: an unassigned lead becomes mine. Requires that it was unassigned,
  -- otherwise an agent who created a lead could take it off whoever holds it.
  if old.assigned_to is null and new.assigned_to = auth.uid() then
    return new;
  end if;

  -- Releasing: a lead of mine goes back to the pool. Requires that it was mine,
  -- for the same reason.
  if new.assigned_to is null and old.assigned_to = auth.uid() then
    return new;
  end if;

  raise exception 'Only an admin or manager can assign a lead to somebody else';
end;
$$;

revoke all on function public.protect_lead_assignment() from public, anon;
grant execute on function public.protect_lead_assignment() to authenticated, service_role;

drop trigger if exists trg_leads_assignment on public.leads;
create trigger trg_leads_assignment
  before update on public.leads
  for each row
  execute function public.protect_lead_assignment();
