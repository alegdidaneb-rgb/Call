import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/apiClient";
import type { Database } from "@/types/database";

type Lead = Database["public"]["Tables"]["leads"]["Row"];

const API_URL = import.meta.env.VITE_API_URL || "";
const isApiMode = Boolean(API_URL);

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

/**
 * Bulk insert, for CSV imports.
 *
 * Inserting a five-hundred-row import one row at a time is five hundred round
 * trips and five hundred cache invalidations, each of which refetches the whole
 * list — so the import gets slower as it goes and the grid re-renders throughout.
 * One statement with one invalidation is both faster and calmer to watch.
 */
export function useCreateLeads() {
  const queryClient = useQueryClient();
  return useMutation<Lead[], Error, Array<Omit<Lead, "id" | "created_at" | "updated_at" | "call_count">>>({
    mutationFn: async (leads) => {
      if (leads.length === 0) return [];
      if (isApiMode) {
        const created: Lead[] = [];
        for (const lead of leads) created.push(await api.leads.create(lead));
        return created;
      }
      const { data, error } = await supabase.from("leads").insert(leads).select();
      if (error) throw error;
      return (data ?? []) as Lead[];
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
