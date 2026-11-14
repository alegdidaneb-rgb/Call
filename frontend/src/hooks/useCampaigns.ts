import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { api, isApiMode } from "@/lib/apiClient";
import type { Database } from "@/types/database";

type Campaign = Database["public"]["Tables"]["campaigns"]["Row"];
type CampaignInsert = Database["public"]["Tables"]["campaigns"]["Insert"];

/**
 * What a new campaign must supply. `type` and `status` are database enums, not
 * free text: declaring them `string` let a typo reach the insert and come back
 * as a constraint error at runtime instead of a red squiggle at the call site.
 */
export interface NewCampaignInput {
  name: string;
  type: NonNullable<CampaignInsert["type"]>;
  status: NonNullable<CampaignInsert["status"]>;
  settings: CampaignInsert["settings"];
}

export function useCampaigns() {
  return useQuery<Campaign[]>({
    queryKey: ["campaigns"],
    queryFn: async () => {
      if (isApiMode) {
        return api.campaigns.list();
      }
      const { data, error } = await supabase
        .from("campaigns")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();
  return useMutation<Campaign, Error, NewCampaignInput>({
    mutationFn: async ({ name, type, status, settings }) => {
      if (isApiMode) {
        return api.campaigns.create({ name, type, status, settings });
      }
      const { data, error } = await supabase.from("campaigns").insert({ name, type, status, settings }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });
}

export function useUpdateCampaign() {
  const queryClient = useQueryClient();
  return useMutation<Campaign, Error, Partial<Campaign> & { id: string }>({
    mutationFn: async ({ id, ...updates }) => {
      if (isApiMode) {
        return api.campaigns.update(id, updates);
      }
      const { data, error } = await supabase
        .from("campaigns")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });
}

export function useDeleteCampaign() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      if (isApiMode) {
        return api.campaigns.delete(id);
      }
      const { error } = await supabase.from("campaigns").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });
}
