import type { ComponentType, ReactNode } from "react";

/**
 * What a screen shows when it has nothing to show.
 *
 * The app had one designed empty state and a dozen bare "No leads" strings. The
 * difference matters more in a dialer than in most products: an agent staring at
 * an empty queue needs to know which of three things happened, because each has
 * a different remedy — there is no data yet, the filters are too narrow, or the
 * fetch failed. Collapsing those into one string sends them to ask a manager
 * about something they could have fixed themselves.
 */

interface EmptyStateProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  /** One or two sentences. Say what to do, not just what is absent. */
  description?: string;
  action?: ReactNode;
  /** Tighter padding for use inside a pane or a card. */
  compact?: boolean;
  tone?: "neutral" | "danger";
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
  tone = "neutral",
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center animate-rise-in ${
        compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-16"
      }`}
    >
      <span
        className={`flex items-center justify-center rounded-full ${
          compact ? "h-9 w-9" : "h-12 w-12"
        } ${tone === "danger" ? "bg-danger/12 text-danger" : "bg-hover text-faint"}`}
      >
        <Icon className={compact ? "h-4 w-4" : "h-5 w-5"} />
      </span>
      <div className="space-y-1">
        <p className={`font-semibold text-ink ${compact ? "text-sm" : "text-base"}`}>{title}</p>
        {description ? (
          <p className={`text-muted leading-relaxed ${compact ? "text-xs" : "text-sm"}`}>{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
