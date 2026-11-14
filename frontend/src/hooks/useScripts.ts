import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { api, isApiMode } from "@/lib/apiClient";
import type { Database } from "@/types/database";

type Script = Database["public"]["Tables"]["call_scripts"]["Row"];
type ScriptInsert = Database["public"]["Tables"]["call_scripts"]["Insert"];

/** Self-hosted deployments talk to the Express API instead of Supabase. */

/**
 * Call scripts, read from the database.
 *
 * This hook exists because the Scripts page and the script viewer both rendered
 * a hardcoded `SAMPLE_SCRIPT` held in `useState`, and neither ever queried
 * `call_scripts`. An agent following that screen was reading a script that no
 * administrator had written and could not change — which is worse than having no
 * script panel at all, because it looks authoritative.
 */
export function useScripts() {
  return useQuery<Script[]>({
    queryKey: ["scripts"],
    queryFn: async () => {
      if (isApiMode) return (await api.scripts.list()) as Script[];
      const { data, error } = await supabase
        .from("call_scripts")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Script[];
    },
  });
}

/**
 * The script an agent should be reading for a given lead.
 *
 * Resolution order matters: a script written for this campaign beats a general
 * one, and among equals an active script beats a retired one. Returning nothing
 * is a legitimate answer — the workspace says "no script for this campaign"
 * rather than substituting text somebody did not approve.
 */
export function useScriptFor(campaignId: string | null | undefined) {
  const query = useScripts();

  const script = useMemo(() => {
    const scripts = query.data ?? [];
    if (scripts.length === 0) return null;
    const active = scripts.filter((candidate) => candidate.is_active);
    const pool = active.length > 0 ? active : scripts;
    if (campaignId) {
      const forCampaign = pool.find((candidate) => candidate.campaign_id === campaignId);
      if (forCampaign) return forCampaign;
    }
    return pool.find((candidate) => candidate.campaign_id === null) ?? pool[0] ?? null;
  }, [query.data, campaignId]);

  return { script, isLoading: query.isLoading, isExactMatch: Boolean(script && campaignId && script.campaign_id === campaignId) };
}

export function useSaveScript() {
  const queryClient = useQueryClient();
  return useMutation<Script, Error, { id: string | null; payload: ScriptInsert }>({
    mutationFn: async ({ id, payload }) => {
      if (isApiMode) {
        return (id ? await api.scripts.update(id, payload) : await api.scripts.create(payload)) as Script;
      }
      const { data, error } = id
        ? await supabase.from("call_scripts").update(payload).eq("id", id).select().single()
        : await supabase.from("call_scripts").insert(payload).select().single();
      if (error) throw error;
      return data as Script;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["scripts"] });
    },
  });
}

export function useDeleteScript() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      if (isApiMode) {
        await api.scripts.delete(id);
        return;
      }
      const { error } = await supabase.from("call_scripts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["scripts"] });
    },
  });
}

export interface Objection {
  objection: string;
  response: string;
  category: string | null;
}

/**
 * `objection_responses` is a JSON column, so its contents have to be narrowed
 * before they are rendered. A malformed row should cost one panel, not the page.
 *
 * Two shapes are in circulation: the seeded scripts store
 * `{ "objection": { response, category } }`, and a plain `{ "objection": "text" }`
 * is what somebody typing into the editor produces. Both are accepted, because a
 * parser that understands only one renders an empty objections panel and gives
 * the agent no reason to doubt the script.
 */
export function parseObjections(value: Script["objection_responses"]): Objection[] {
  if (!value || typeof value !== "object") return [];

  const parsed: Objection[] = [];
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const objection = key.replace(/_/g, " ");
    if (typeof raw === "string") {
      if (raw.trim()) parsed.push({ objection, response: raw, category: null });
      continue;
    }
    if (raw && typeof raw === "object") {
      const record = raw as Record<string, unknown>;
      const response = typeof record.response === "string" ? record.response : null;
      const category = typeof record.category === "string" ? record.category : null;
      if (response && response.trim()) parsed.push({ objection, response, category });
    }
  }
  return parsed;
}
