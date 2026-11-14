import type { ReactNode } from "react";

/**
 * The opening of every page.
 *
 * Eleven pages each hand-rolled their own title, at four different sizes, with
 * the description sometimes present and sometimes not, and the actions sometimes
 * beside the title, sometimes below it, sometimes right-aligned and sometimes
 * not. That inconsistency is invisible one page at a time and obvious the moment
 * somebody clicks between them — which is most of what "looks unprofessional"
 * amounts to.
 *
 * One component also gives the heading structure a single definition, so the
 * `h1`/`p` pairing is correct everywhere instead of correct where somebody
 * remembered.
 */

interface PageHeaderProps {
  title: string;
  /**
   * One sentence saying what the page is for, or what state it is in. Prefer a
   * live count over a static description: "18 of 240 shown" tells an operator
   * something; "Manage your leads" does not.
   */
  description?: ReactNode;
  actions?: ReactNode;
  /** Filters and controls that belong to the header but need a second row. */
  children?: ReactNode;
}

export function PageHeader({ title, description, actions, children }: PageHeaderProps) {
  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
          {description ? (
            <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}
