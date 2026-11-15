import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, isApiMode } from "@/lib/apiClient";
import { supabase } from "@/lib/supabase";
import { isProvisioned, normaliseRole, type AppRole } from "@/types/app";

/**
 * Somebody work can be given to — a SIP trunk, or leads to call.
 *
 * One shape for both, because both are the same question: which people can this
 * be handed to, and what should the picker call them. It lived inside the SIP
 * hook while a trunk was the only thing being assigned; leads are the second, and
 * a second copy of the fetch would mean two places to keep the role and
 * provisioning rules in step.
 *
 * The two deployment modes return different field names for the same person:
 * Supabase gives a `profiles` row with `full_name`, the Express API gives the
 * public user shape with `fullName`. Normalising here means neither caller can be
 * wrong — an earlier version declared the Supabase type and cast the API response
 * into it, so in API mode `full_name` was always undefined and the dropdown
 * quietly showed email addresses instead of names.
 */
export interface AssignablePerson {
  id: string;
  /** What a picker shows; `email` is only a last resort. */
  username: string | null;
  email: string | null;
  fullName: string | null;
  role: AppRole;
  /**
   * Whether an administrator has onboarded this account. An unprovisioned agent
   * can read no data under RLS, so handing work to one is a no-op — the lead
   * disappears from everybody's list and the agent sees nothing. Callers show
   * these people but mark them, rather than hiding them and making the account
   * look absent.
   */
  provisioned: boolean;
}

/**
 * What a picker shows for a person.
 *
 * Name first, then username, then email. Email last because addresses are being
 * phased out of the product: an account created since migration 005 has a
 * synthetic one that nobody reads, and showing it would suggest the address means
 * something.
 */
export function personLabel(person: AssignablePerson): string {
  return person.fullName?.trim() || person.username || person.email || "Unknown";
}

/**
 * What to call whoever owns a lead, given what this reader is allowed to know.
 *
 * An agent reading `profiles` under row-level security gets exactly one row —
 * their own — so a colleague's id resolves to nothing for them, and reporting that
 * as "Removed user" would be a lie about every assigned lead in the list. Three
 * cases are actually distinguishable from an agent's seat: nobody owns it, I own
 * it, and somebody does. Only a privileged reader, who has the whole roster
 * loaded, can tell a deleted profile apart from a name they were never given.
 *
 * Lives here rather than in the grid because the lead detail page needs the same
 * sentence, and two copies of a labelling rule drift until one screen says
 * "Unassigned" and another says "Removed user" about the same row.
 */
export function ownerLabel(
  assignedTo: string | null,
  peopleById: Map<string, AssignablePerson>,
  currentUserId: string | null,
  canReadRoster: boolean,
): string {
  if (!assignedTo) return "Unassigned";
  const person = peopleById.get(assignedTo);
  if (person) return personLabel(person);
  if (assignedTo === currentUserId) return "You";
  return canReadRoster ? "Removed user" : "Assigned";
}

/**
 * The people work can be assigned to.
 *
 * The query key is shared with the SIP trunk picker, so opening both screens
 * fetches once. `enabled` exists because an agent has no reason to load the
 * roster: the controls that use it are not rendered for them, and row-level
 * security would hand back only their own profile anyway — one row, which cannot
 * populate a picker.
 */
export function useAssignablePeople(enabled = true) {
  const query = useQuery({
    queryKey: ["profiles-for-assignment"],
    enabled,
    queryFn: async (): Promise<AssignablePerson[]> => {
      if (isApiMode) {
        const users = await api.users.list();
        return users.map((user) => ({
          id: user.id,
          username: user.username,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          provisioned: user.provisioned,
        }));
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, email, full_name, role, invited_by");
      if (error) throw error;
      return (data ?? []).map((row) => {
        const role = normaliseRole(row.role);
        return {
          id: row.id,
          username: row.username,
          email: row.email,
          fullName: row.full_name,
          role,
          provisioned: isProvisioned(role, row.invited_by),
        };
      });
    },
  });

  const people = useMemo(() => query.data ?? [], [query.data]);

  /**
   * Sorted for a picker: people who can actually be given work first, then by
   * name. An unprovisioned account sinks to the bottom rather than being removed,
   * so assigning to one by mistake is visible as a mistake.
   */
  const assignable = useMemo(
    () =>
      [...people].sort((a, b) => {
        if (a.provisioned !== b.provisioned) return a.provisioned ? -1 : 1;
        return personLabel(a).localeCompare(personLabel(b));
      }),
    [people],
  );

  const byId = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);

  return { ...query, people, assignable, byId };
}
