import { useEffect } from "react";
import { AlertTriangle, BookOpen, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/common/Skeleton";
import { parseObjections, useScriptFor } from "@/hooks/useScripts";
import { pushOverlay } from "@/lib/keys";

/**
 * The script for a lead, in a dialog.
 *
 * This component used to hold a `SAMPLE_SCRIPT` constant in `useState` and render
 * that, unconditionally, for every lead in every campaign. It was the second
 * consumer of the same fabricated content the Scripts page had, and fixing only
 * the page left an agent who opened a lead's record reading a script about
 * medical practices that no administrator had written and could not change.
 *
 * It resolves the real script against the lead's campaign now, and says so when
 * there isn't one.
 */

interface CallScriptViewerProps {
  /** The lead's campaign, used to pick a campaign-specific script over a general one. */
  campaignId?: string | null;
  onClose: () => void;
}

export function CallScriptViewer({ campaignId, onClose }: CallScriptViewerProps) {
  const { script, isLoading, isExactMatch } = useScriptFor(campaignId ?? null);
  const objections = parseObjections(script?.objection_responses ?? null);

  useEffect(() => pushOverlay(), []);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay/70 p-4 animate-fade-in sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={script ? script.title : "Call script"}
      onClick={onClose}
    >
      <div
        className="my-auto w-full max-w-2xl overflow-hidden rounded-xl border border-line-strong bg-panel shadow-floating animate-scale-in"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 truncate text-base font-semibold text-ink">
              <BookOpen className="h-4 w-4 shrink-0 text-accent" />
              {isLoading ? "Loading script" : (script?.title ?? "No script")}
            </h2>
            {script ? (
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-faint">
                <span className="chip bg-accent/12 text-accent">{script.category}</span>
                <span>{isExactMatch ? "written for this campaign" : "general script"}</span>
              </p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm shrink-0" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ) : script ? (
            <>
              <p className="whitespace-pre-wrap rounded-lg bg-inset p-3 text-sm leading-relaxed text-ink">
                {script.content}
              </p>

              {objections.length > 0 ? (
                <section className="space-y-2">
                  <h3 className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">
                    <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                    If they object
                  </h3>
                  <ul className="space-y-1.5">
                    {objections.map((entry) => (
                      <li key={entry.objection} className="rounded-lg border border-line bg-panel px-3 py-2">
                        <p className="text-sm font-semibold text-ink">“{entry.objection}”</p>
                        <p className="mt-1 text-sm leading-relaxed text-muted">{entry.response}</p>
                        {entry.category ? (
                          <p className="mt-1 text-2xs font-semibold uppercase tracking-wider text-faint">
                            {entry.category}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          ) : (
            <div className="py-6 text-center">
              <p className="text-sm text-muted">
                There is no script for this lead{campaignId ? "'s campaign" : ""}.
              </p>
              <p className="mt-1 text-2xs text-faint">
                <Link to="/scripts" className="font-semibold text-accent underline underline-offset-2">
                  Write one
                </Link>{" "}
                and it will appear here and beside the dial button in the workspace.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
