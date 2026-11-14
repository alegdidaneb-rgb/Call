/**
 * The product mark and wordmark.
 *
 * The sign-in screen used a coloured `<h1>` reading "Cold Dialer" and the setup
 * screen used a lucide shield in a tile — two unrelated identities for the same
 * product, neither of which appeared anywhere else. One component gives both
 * screens, and anything that later needs a mark, the same thing.
 *
 * The glyph is a keypad over a call line, drawn inline rather than pulled from
 * an icon set so the mark is not a stock icon somebody else also uses.
 */

interface MarkProps {
  /** Tile size in pixels. The glyph scales to fit. */
  size?: number;
  className?: string;
}

export function BrandMark({ size = 40, className = "" }: MarkProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-accent text-inverse ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="none" width={size * 0.6} height={size * 0.6}>
        <g fill="currentColor">
          <circle cx="7" cy="6.5" r="1.35" />
          <circle cx="12" cy="6.5" r="1.35" />
          <circle cx="17" cy="6.5" r="1.35" />
          <circle cx="7" cy="11.5" r="1.35" />
          <circle cx="12" cy="11.5" r="1.35" />
          <circle cx="17" cy="11.5" r="1.35" />
        </g>
        <path
          d="M5.5 17.2c3.6 2.3 9.4 2.3 13 0"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

interface BrandProps {
  /** Rendered beside the mark. Defaults to the product name. */
  tagline?: string;
  size?: number;
}

export function Brand({ tagline, size = 40 }: BrandProps) {
  return (
    <div className="flex items-center gap-3">
      <BrandMark size={size} />
      <div className="min-w-0">
        <p className="text-xl font-bold tracking-tight text-ink">Cold Dialer</p>
        {tagline ? <p className="mt-0.5 text-xs text-muted">{tagline}</p> : null}
      </div>
    </div>
  );
}
