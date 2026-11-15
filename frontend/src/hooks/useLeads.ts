import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { api, isApiMode, type ImportError } from "@/lib/apiClient";
import type { Database } from "@/types/database";

type Lead = Database["public"]["Tables"]["leads"]["Row"];


export function useLeads() {
  return useQuery<Lead[]>({
    queryKey: ["leads"],
    queryFn: async () => {
      if (isApiMode) {
        return api.leads.list();
      }
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useLead(leadId: string) {
  return useQuery<Lead>({
    queryKey: ["leads", leadId],
    queryFn: async () => {
      if (isApiMode) {
        return api.leads.get(leadId);
      }
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .eq("id", leadId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!leadId,
  });
}

export function useCreateLead() {
  const queryClient = useQueryClient();
  return useMutation<Lead, Error, Omit<Lead, "id" | "created_at" | "updated_at" | "call_count">>({
    mutationFn: async (lead) => {
      if (isApiMode) {
        return api.leads.create(lead);
      }
      const { data, error } = await supabase.from("leads").insert(lead).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

export function useUpdateLead() {
  const queryClient = useQueryClient();
  return useMutation<Lead, Error, Partial<Lead> & { id: string }>({
    mutationFn: async ({ id, ...updates }) => {
      if (isApiMode) {
        return api.leads.update(id, updates);
      }
      const { data, error } = await supabase
        .from("leads")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

export interface AssignLeadsVariables {
  leadIds: string[];
  /** `null` takes the leads back into the unassigned pool. */
  assignedTo: string | null;
}

/**
 * Assigns a set of leads to one person, in a single write.
 *
 * Not built on `useUpdateLead` per lead. Distributing an import is the ordinary
 * case here — five hundred leads split between five agents — and a loop is five
 * hundred round trips, each invalidating the list and re-rendering the grid while
 * it goes. It would also be partially applied on failure, leaving an assignment
 * half-finished with no way to tell which half.
 *
 * Both deployment modes do it in one statement: `.in()` on Supabase, `= ANY($2)`
 * on the Express API.
 */
export interface AssignLeadsResult {
  /** Rows that actually changed. */
  changed: number;
  /** Rows asked for. The two differ when a lead was deleted elsewhere meanwhile. */
  requested: number;
}

export function useAssignLeads() {
  const queryClient = useQueryClient();
  return useMutation<AssignLeadsResult, Error, AssignLeadsVariables>({
    mutationFn: async ({ leadIds, assignedTo }): Promise<AssignLeadsResult> => {
      if (leadIds.length === 0) return { changed: 0, requested: 0 };
      if (isApiMode) {
        const result = await api.leads.assign(leadIds, assignedTo);
        return { changed: result.assigned, requested: leadIds.length };
      }
      const { data, error } = await supabase
        .from("leads")
        .update({ assigned_to: assignedTo })
        .in("id", leadIds)
        .select();
      if (error) throw error;
      return { changed: (data ?? []).length, requested: leadIds.length };
    },
    onSuccess: () => {
      // The dialling queue derives from `useLeads` rather than fetching anything
      // of its own, so this one invalidation reaches it: an agent's next lead to
      // call depends on who owns it.
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

/**
 * Bulk insert, for CSV imports.
 *
 * Inserting a five-hundred-row import one row at a time is five hundred round
 * trips and five hundred cache invalidations, each of which refetches the whole
 * list — so the import gets slower as it goes and the grid re-renders throughout.
 * One statement with one invalidation is both faster and calmer to watch.
 */
export type NewLead = Omit<Lead, "id" | "created_at" | "updated_at" | "call_count">;

export interface BulkImportVariables {
  rows: NewLead[];
  /** Attributes every imported lead to one campaign, or leaves them unassigned. */
  campaignId?: string | null;
}

export interface BulkImportResult {
  imported: number;
  /**
   * Rows the store refused. Supabase rejects the whole statement or none of it,
   * so this is only ever non-zero on the API path, which imports row by row and
   * reports the ones that failed.
   */
  failed: number;
  errors: ImportError[];
}

export function useCreateLeads() {
  const queryClient = useQueryClient();
  return useMutation<BulkImportResult, Error, BulkImportVariables>({
    mutationFn: async ({ rows, campaignId = null }) => {
      if (rows.length === 0) return { imported: 0, failed: 0, errors: [] };

      if (isApiMode) {
        // The backend has a bulk endpoint for exactly this; calling `create` in
        // a loop was one round trip per row, which is what the comment above
        // says not to do.
        const result = await api.leads.import(rows, campaignId);
        return { imported: result.imported, failed: result.failed, errors: result.errors };
      }

      const stamped = campaignId
        ? rows.map((row) => ({ ...row, campaign_id: campaignId }))
        : rows;
      const { data, error } = await supabase.from("leads").insert(stamped).select();
      if (error) throw error;
      const created = (data ?? []) as Lead[];
      return {
        imported: created.length,
        failed: Math.max(rows.length - created.length, 0),
        errors: [],
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

export function useDeleteLead() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      if (isApiMode) {
        return api.leads.delete(id);
      }
      const { error } = await supabase.from("leads").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}
