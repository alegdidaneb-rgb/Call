import type { CSSProperties } from "react";

/**
 * Loading placeholders.
 *
 * A spinner tells the agent nothing about what is coming. These match the shape
 * of the real content, so the layout does not jump when data lands and a slow
 * query reads as "working" rather than "stuck".
 */

interface SkeletonProps {
  className?: string;
  /** For widths that are computed rather than one of a fixed set of utilities. */
  style?: CSSProperties;
}

export function Skeleton({ className = "", style }: SkeletonProps) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden="true" />;
}

/**
 * A list of placeholder rows for a queue, table or grid.
 *
 * Widths vary deterministically rather than randomly so the block looks like
 * data instead of noise, and so a re-render does not make it flicker.
 */
export function SkeletonRows({
  rows = 6,
  className = "",
  rowClassName = "h-12",
}: {
  rows?: number;
  className?: string;
  rowClassName?: string;
}) {
  return (
    <div className={className} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={`flex items-center gap-3 border-b border-line px-3 ${rowClassName}`}
        >
          <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton style={{ width: `${58 + ((index * 13) % 34)}%` }} className="h-3" />
            <Skeleton style={{ width: `${34 + ((index * 17) % 28)}%` }} className="h-2.5" />
          </div>
          <Skeleton className="h-5 w-14 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder for a grid of summary tiles. */
export function SkeletonCards({ cards = 4, className = "" }: { cards?: number; className?: string }) {
  return (
    <div className={`grid gap-3 ${className}`} aria-hidden="true">
      {Array.from({ length: cards }, (_, index) => (
        <div key={index} className="card space-y-3 p-4">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-2 w-24" />
        </div>
      ))}
    </div>
  );
}
