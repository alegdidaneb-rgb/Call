import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { pushOverlay } from "@/lib/keys";
import type { Database } from "@/types/database";

type Script = Database["public"]["Tables"]["call_scripts"]["Row"];
type ScriptInsert = Database["public"]["Tables"]["call_scripts"]["Insert"];
type Campaign = Database["public"]["Tables"]["campaigns"]["Row"];

/**
 * Writing and editing a call script.
 *
 * The page this belongs to could previously only display a script that shipped in
 * the source file: there was no way to write one, change one, or attach one to a
 * campaign. That made the workspace's script panel permanent decoration, so this
 * exists to make it real — a script saved here is what an agent reads mid-call.
 *
 * Objections are edited as rows and stored as a keyed object, which is the shape
 * the seeded scripts already use, so nothing has to be migrated to read either.
 */

interface ObjectionDraft {
  objection: string;
  response: string;
  category: string;
}

interface ScriptEditorProps {
  script: Script | null;
  campaigns: Campaign[];
  onClose: () => void;
  onSave: (payload: ScriptInsert, id: string | null) => Promise<void>;
}

function toDrafts(value: Script["objection_responses"]): ObjectionDraft[] {
  if (!value || typeof value !== "object") return [];
  const drafts: ObjectionDraft[] = [];
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") {
      drafts.push({ objection: key, response: raw, category: "" });
      continue;
    }
    if (raw && typeof raw === "object") {
      const record = raw as Record<string, unknown>;
      drafts.push({
        objection: key,
        response: typeof record.response === "string" ? record.response : "",
        category: typeof record.category === "string" ? record.category : "",
      });
    }
  }
  return drafts;
}

function toRecord(drafts: ObjectionDraft[]): Record<string, { response: string; category: string }> {
  const record: Record<string, { response: string; category: string }> = {};
  for (const draft of drafts) {
    const key = draft.objection.trim();
    if (!key || !draft.response.trim()) continue;
    record[key] = {
      response: draft.response.trim(),
      category: draft.category.trim() || "general",
    };
  }
  return record;
}

export function ScriptEditor({ script, campaigns, onClose, onSave }: ScriptEditorProps) {
  const [title, setTitle] = useState(script?.title ?? "");
  const [category, setCategory] = useState(script?.category ?? "");
  const [content, setContent] = useState(script?.content ?? "");
  const [campaignId, setCampaignId] = useState(script?.campaign_id ?? "");
  const [isActive, setIsActive] = useState(script?.is_active ?? true);
  const [objections, setObjections] = useState<ObjectionDraft[]>(() =>
    toDrafts(script?.objection_responses ?? null),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => pushOverlay(), []);

  function updateObjection(index: number, patch: Partial<ObjectionDraft>) {
    setObjections((current) =>
      current.map((draft, position) => (position === index ? { ...draft, ...patch } : draft)),
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !content.trim()) {
      setError("A script needs a title and the words to say.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(
        {
          title: title.trim(),
          category: category.trim() || "General",
          content: content.trim(),
          objection_responses: toRecord(objections),
          campaign_id: campaignId || null,
          is_active: isActive,
        },
        script?.id ?? null,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the script");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay p-4 animate-fade-in sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={script ? "Edit script" : "New script"}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(event) => event.stopPropagation()}
        className="my-auto w-full max-w-2xl overflow-hidden rounded-xl border border-line-strong bg-panel shadow-floating animate-scale-in"
      >
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{script ? "Edit script" : "New script"}</h2>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="script-title" className="label">
                Title
              </label>
              <input
                id="script-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Cold outreach — SaaS trial"
                className="input"
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="script-category" className="label">
                Category
              </label>
              <input
                id="script-category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="Outbound"
                className="input"
              />
            </div>

            <div>
              <label htmlFor="script-campaign" className="label">
                Campaign
              </label>
              <select
                id="script-campaign"
                value={campaignId}
                onChange={(event) => setCampaignId(event.target.value)}
                className="input"
              >
                <option value="">Every campaign</option>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-2xs leading-relaxed text-faint">
                A lead in that campaign is shown this script in the workspace. Otherwise the general
                script is used.
              </p>
            </div>
          </div>

          <div>
            <label htmlFor="script-content" className="label">
              What to say
            </label>
            <textarea
              id="script-content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={8}
              placeholder={"Good morning, this is …\n\nThe agent reads this during the call."}
              className="input resize-y leading-relaxed"
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="label !mb-0">If they object</span>
              <button
                type="button"
                onClick={() =>
                  setObjections((current) => [...current, { objection: "", response: "", category: "" }])
                }
                className="btn btn-secondary btn-sm"
              >
                <Plus className="h-3 w-3" />
                Add
              </button>
            </div>

            {objections.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-faint">
                No objections yet. Add the ones you actually hear, with the answer that works.
              </p>
            ) : (
              <ul className="space-y-2">
                {objections.map((draft, index) => (
                  <li key={index} className="space-y-1.5 rounded-lg border border-line bg-inset p-2.5 animate-rise-in">
                    <div className="flex items-center gap-2">
                      <input
                        value={draft.objection}
                        onChange={(event) => updateObjection(index, { objection: event.target.value })}
                        placeholder="“Send me an email instead”"
                        aria-label={`Objection ${index + 1}`}
                        className="input !py-1.5 !text-sm font-medium"
                      />
                      <button
                        type="button"
                        onClick={() => setObjections((current) => current.filter((_, position) => position !== index))}
                        aria-label={`Remove objection ${index + 1}`}
                        className="shrink-0 rounded p-1.5 text-faint transition-colors hover:bg-danger/12 hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <textarea
                      value={draft.response}
                      onChange={(event) => updateObjection(index, { response: event.target.value })}
                      rows={2}
                      placeholder="The answer that works"
                      aria-label={`Response to objection ${index + 1}`}
                      className="input resize-y !py-1.5 !text-sm leading-relaxed"
                    />
                    <input
                      value={draft.category}
                      onChange={(event) => updateObjection(index, { category: event.target.value })}
                      placeholder="Category (optional)"
                      aria-label={`Category for objection ${index + 1}`}
                      className="input !py-1 !text-2xs"
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-inset px-3 py-2">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
              className="h-4 w-4 rounded border-line-strong bg-panel"
            />
            <span className="text-sm text-ink">Active</span>
            <span className="text-2xs text-faint">— inactive scripts are not shown to agents</span>
          </label>

          {error ? (
            <p className="rounded-lg bg-danger/12 px-3 py-2 text-xs text-danger">{error}</p>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line bg-inset px-4 py-3">
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
            {saving ? "Saving…" : script ? "Save changes" : "Create script"}
          </button>
        </footer>
      </form>
    </div>
  );
}
