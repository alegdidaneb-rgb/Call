import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { BookOpen, FileText, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { SkeletonCards } from "@/components/common/Skeleton";
import { ScriptEditor } from "@/components/scripts/ScriptEditor";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useDeleteScript, useSaveScript, useScripts, parseObjections } from "@/hooks/useScripts";
import { chipClass } from "@/lib/outcomes";
import type { Database } from "@/types/database";

type Script = Database["public"]["Tables"]["call_scripts"]["Row"];
type ScriptInsert = Database["public"]["Tables"]["call_scripts"]["Insert"];

/**
 * Call scripts.
 *
 * This page used to render one script that was hardcoded in the file itself, held
 * in `useState`, with a search box that filtered a list of one and a close button
 * drawn as a magnifying glass. Nothing on it could be created or changed, and the
 * `call_scripts` table it was named after was never queried.
 *
 * It reads and writes the table now. That is not cosmetic: the workspace shows an
 * agent the script for the lead they are calling, so until this page could write
 * one, every agent was reading either nothing or text no manager had approved.
 */

export function ScriptsPage() {
  const scriptsQuery = useScripts();
  const campaignsQuery = useCampaigns();
  const saveScript = useSaveScript();
  const deleteScript = useDeleteScript();

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Script | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Script | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const scripts = useMemo(() => scriptsQuery.data ?? [], [scriptsQuery.data]);
  const campaigns = useMemo(() => campaignsQuery.data ?? [], [campaignsQuery.data]);

  const campaignName = (id: string | null) =>
    id ? (campaigns.find((campaign) => campaign.id === id)?.name ?? "unknown campaign") : null;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return scripts;
    return scripts.filter((script) =>
      [script.title, script.category, script.content, campaignName(script.campaign_id)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
    // campaignName is a stable derivation over `campaigns`, so it does not need
    // to be a dependency of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scripts, search, campaigns]);

  async function handleSave(payload: ScriptInsert, id: string | null) {
    try {
      await saveScript.mutateAsync({ id, payload });
      toast.success(id ? "Script updated" : "Script created");
      setCreating(false);
      setEditing(null);
    } catch (error) {
      // Rethrown so the editor stays open with its contents; the toast is the
      // visible half of the failure.
      toast.error(error instanceof Error ? error.message : "Could not save the script");
      throw error;
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteScript.mutateAsync(deleteTarget.id);
      toast.success("Script deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the script");
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title="Call scripts"
        description={
          scripts.length === 0
            ? "No scripts yet — an agent calling from the workspace will see nothing to read"
            : `${scripts.length} script${scripts.length === 1 ? "" : "s"} · shown to agents in the workspace while they call`
        }
        actions={
          <button type="button" onClick={() => setCreating(true)} className="btn btn-primary btn-sm">
            <Plus className="h-3.5 w-3.5" />
            New script
          </button>
        }
      />

      {scripts.length > 0 ? (
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search scripts"
            aria-label="Search scripts"
            className="input !pl-8"
          />
        </div>
      ) : null}

      {scriptsQuery.isLoading ? (
        <SkeletonCards cards={3} className="md:grid-cols-2 lg:grid-cols-3" />
      ) : scriptsQuery.isError ? (
        <div className="card">
          <EmptyState
            tone="danger"
            icon={FileText}
            title="Could not load scripts"
            description={
              scriptsQuery.error instanceof Error ? scriptsQuery.error.message : "The request failed."
            }
            action={
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void scriptsQuery.refetch()}>
                Try again
              </button>
            }
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          {search ? (
            <EmptyState
              icon={Search}
              title="No script matches"
              description={`Nothing matches "${search}".`}
              action={
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSearch("")}>
                  Clear search
                </button>
              }
            />
          ) : (
            <EmptyState
              icon={BookOpen}
              title="No scripts yet"
              description="Write the words an agent should say. Attach it to a campaign and every lead in that campaign gets it beside the dial button; leave it general and it is the fallback."
              action={
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  Write the first script
                </button>
              }
            />
          )}
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {filtered.map((script) => {
            const objections = parseObjections(script.objection_responses);
            const isOpen = expanded === script.id;
            const campaign = campaignName(script.campaign_id);
            return (
              <li key={script.id} className="card flex flex-col overflow-hidden animate-rise-in">
                <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-ink">{script.title}</h2>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className={`chip !text-2xs ${chipClass("accent")}`}>{script.category}</span>
                      <span
                        className={`chip !text-2xs ${chipClass(script.is_active ? "success" : "neutral")}`}
                      >
                        {script.is_active ? "Active" : "Inactive"}
                      </span>
                      {campaign ? (
                        <span className={`chip !text-2xs ${chipClass("info")}`}>{campaign}</span>
                      ) : (
                        <span className={`chip !text-2xs ${chipClass("neutral")}`}>General</span>
                      )}
                      {objections.length > 0 ? (
                        <span className={`chip !text-2xs ${chipClass("warning")}`}>
                          {objections.length} objection{objections.length === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => setEditing(script)}
                      aria-label={`Edit ${script.title}`}
                      title="Edit"
                      className="rounded p-1.5 text-faint transition-colors hover:bg-hover hover:text-accent"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(script)}
                      aria-label={`Delete ${script.title}`}
                      title="Delete"
                      className="rounded p-1.5 text-faint transition-colors hover:bg-danger/12 hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="min-w-0 flex-1 px-4 py-3">
                  <p
                    className={`whitespace-pre-wrap text-sm leading-relaxed text-muted ${
                      isOpen ? "" : "line-clamp-3"
                    }`}
                  >
                    {script.content}
                  </p>

                  {isOpen && objections.length > 0 ? (
                    <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
                      {objections.map((entry) => (
                        <li key={entry.objection} className="rounded-lg bg-inset px-2.5 py-2">
                          <p className="text-xs font-semibold text-ink">“{entry.objection}”</p>
                          <p className="mt-1 text-xs leading-relaxed text-muted">{entry.response}</p>
                          {entry.category ? (
                            <p className="mt-1 text-2xs font-semibold uppercase tracking-wider text-faint">
                              {entry.category}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2">
                  <span className="text-2xs text-faint">
                    Updated {new Date(script.updated_at ?? script.created_at).toLocaleDateString()}
                  </span>
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : script.id)}
                    className="btn btn-ghost btn-sm"
                    aria-expanded={isOpen}
                  >
                    {isOpen ? "Collapse" : "Read"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="flex items-center gap-1.5 text-2xs text-faint">
        <FileText className="h-3 w-3" />
        Scripts appear beside the dial button in the{" "}
        <Link to="/workspace" className="font-semibold text-accent underline underline-offset-2">
          workspace
        </Link>
        , resolved against each lead's campaign.
      </p>

      {creating || editing ? (
        <ScriptEditor
          script={editing}
          campaigns={campaigns}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={handleSave}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete script"
        message={`Delete "${deleteTarget?.title}"? Agents calling leads in ${
          campaignName(deleteTarget?.campaign_id ?? null) ?? "any campaign"
        } will no longer see it.`}
        variant="danger"
        confirmLabel="Delete script"
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
