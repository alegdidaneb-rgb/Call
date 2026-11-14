import { useId } from "react";
import type { Tone } from "@/lib/outcomes";

/**
 * Small chart primitives.
 *
 * Hand-rolled rather than a charting dependency, for three reasons that matter
 * more here than they would in a marketing site:
 *
 * - The dashboard is in the main chunk's dependency graph, and a chart library
 *   costs more than every chart on the page is worth.
 * - These read their colours from the same CSS variables as everything else, so
 *   they follow a theme switch instantly instead of needing a re-mount with a new
 *   palette prop.
 * - There are four chart shapes in the whole product. A dependency that solves
 *   forty is not a trade.
 *
 * All three are deliberately dumb: they take numbers and draw them. Every
 * judgement about what to show lives in the page.
 */

/** A tone as a live CSS colour, resolved at paint time. */
function cssColor(tone: Tone): string {
  const name =
    tone === "neutral" ? "steel" : tone === "accent" ? "accent" : tone === "alt" ? "alt" : tone;
  return `rgb(var(--c-${name}))`;
}

/* ---------------------------------------------------------------- sparkline */

interface SparklineProps {
  values: number[];
  tone?: Tone;
  /** Rendered height in CSS pixels; the path scales to the container width. */
  height?: number;
  className?: string;
}

/**
 * A trend, with no axes.
 *
 * The shape is the information: whether calls are rising or falling matters more
 * on a dashboard tile than the exact value on any given day, and the exact value
 * is printed next to it. `vector-effect="non-scaling-stroke"` is what lets the
 * path stretch to any width without the stroke thinning horizontally.
 */
export function Sparkline({ values, tone = "accent", height = 36, className = "" }: SparklineProps) {
  const gradientId = useId();
  const color = cssColor(tone);

  if (values.length < 2) {
    return <div className={className} style={{ height }} aria-hidden="true" />;
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const width = 100;
  const pad = 2;

  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    // Invert: SVG y grows downwards, charts grow upwards.
    const y = pad + (1 - (value - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });

  const line = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const last = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      style={{ height, width: "100%", display: "block", overflow: "visible" }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* The current value, marked so the eye lands on the end of the trend. */}
      <circle cx={last[0]} cy={last[1]} r="2" fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ------------------------------------------------------------------ columns */

export interface BarDatum {
  label: string;
  value: number;
  tone?: Tone;
  /** Shown instead of the raw number when supplied, e.g. "42%". */
  display?: string;
}

interface BarChartProps {
  data: BarDatum[];
  /** Height of the plotting area, in CSS pixels. */
  height?: number;
  /** Render bars horizontally, for labels too long to sit under a column. */
  horizontal?: boolean;
  emptyMessage?: string;
}

/**
 * Columns, or rows when the labels are words rather than dates.
 *
 * Built from HTML rather than SVG so the labels stay real text: they scale with
 * the density setting, they are selectable, and a screen reader gets them
 * without an `aria-label` written by hand. Height animates on mount, which is
 * the only motion here and it exists to make a value change legible.
 */
export function BarChart({
  data,
  height = 96,
  horizontal = false,
  emptyMessage = "Nothing to chart yet",
}: BarChartProps) {
  const max = Math.max(...data.map((datum) => datum.value), 1);
  const anyValue = data.some((datum) => datum.value > 0);

  if (!anyValue) {
    return <p className="py-6 text-center text-xs text-faint">{emptyMessage}</p>;
  }

  if (horizontal) {
    return (
      <ul className="space-y-2">
        {data.map((datum) => (
          <li key={datum.label} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[12px] font-medium text-ink">{datum.label}</span>
              <span className="tabular shrink-0 text-[11px] font-semibold text-muted">
                {datum.display ?? datum.value}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-inset">
              <div
                className="h-full rounded-full transition-[width] duration-500 ease-spring"
                style={{
                  width: `${Math.max((datum.value / max) * 100, datum.value > 0 ? 2 : 0)}%`,
                  backgroundColor: cssColor(datum.tone ?? "accent"),
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {data.map((datum) => (
        <div key={datum.label} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
          <span className="tabular text-[10px] font-semibold text-faint opacity-0 transition-opacity group-hover:opacity-100">
            {datum.display ?? datum.value}
          </span>
          <div
            className="w-full rounded-t transition-[height] duration-500 ease-spring"
            style={{
              height: `${Math.max((datum.value / max) * 100, datum.value > 0 ? 2 : 0)}%`,
              backgroundColor: cssColor(datum.tone ?? "accent"),
              opacity: datum.value === 0 ? 0.18 : 1,
            }}
            title={`${datum.label}: ${datum.display ?? datum.value}`}
          />
          <span className="w-full truncate text-center text-[10px] text-faint">{datum.label}</span>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------- donut */

export interface DonutSegment {
  label: string;
  value: number;
  tone: Tone;
}

interface DonutProps {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  /** Big number in the middle, usually the total. */
  centreValue?: string;
  centreLabel?: string;
}

/**
 * Proportions, with a legend beside it.
 *
 * Segments are drawn as dash-offset arcs on a single circle rather than as wedge
 * paths, which keeps the maths to two lines and makes the gaps between segments
 * a stroke property instead of a trigonometry problem. Zero-value segments are
 * skipped so they cannot draw a stray dot.
 */
export function Donut({
  segments,
  size = 132,
  thickness = 14,
  centreValue,
  centreLabel,
}: DonutProps) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgb(var(--c-inset))"
            strokeWidth={thickness}
          />
          {/* Rotated so the first segment starts at twelve o'clock. */}
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {total > 0
              ? segments.map((segment) => {
                  if (segment.value <= 0) return null;
                  const length = (segment.value / total) * circumference;
                  // A hairline gap keeps adjacent segments distinguishable when
                  // two tones are close in the current theme.
                  const gap = segments.filter((candidate) => candidate.value > 0).length > 1 ? 1.5 : 0;
                  const arc = (
                    <circle
                      key={segment.label}
                      cx={size / 2}
                      cy={size / 2}
                      r={radius}
                      fill="none"
                      stroke={cssColor(segment.tone)}
                      strokeWidth={thickness}
                      strokeDasharray={`${Math.max(length - gap, 0.5)} ${circumference}`}
                      strokeDashoffset={-offset}
                      strokeLinecap="butt"
                    >
                      <title>{`${segment.label}: ${segment.value}`}</title>
                    </circle>
                  );
                  offset += length;
                  return arc;
                })
              : null}
          </g>
        </svg>
        {centreValue ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="tabular text-xl font-bold text-ink">{centreValue}</span>
            {centreLabel ? (
              <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">
                {centreLabel}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <ul className="min-w-0 flex-1 space-y-1.5">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-sm"
              style={{ backgroundColor: cssColor(segment.tone) }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{segment.label}</span>
            <span className="tabular shrink-0 text-[12px] font-semibold text-ink">{segment.value}</span>
            <span className="tabular w-10 shrink-0 text-right text-[11px] text-faint">
              {total > 0 ? `${Math.round((segment.value / total) * 100)}%` : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
