import type { ReactNode } from "react";
import { Brand } from "@/components/common/Brand";

/**
 * The shell both unauthenticated screens sit in.
 *
 * Sign-in and first-run setup each hand-rolled the same full-height gradient,
 * card and footer link, and had already drifted: one centred a wordmark above
 * the card, the other put an icon inside it. They are the first thing anybody
 * sees of the product, so they should look like the same product.
 */

interface AuthScreenProps {
  /** One line under the wordmark saying what the product is. */
  tagline: string;
  title: string;
  description?: string;
  children: ReactNode;
  /** Below the card — usually a link to the other unauthenticated screen. */
  footer?: ReactNode;
}

export function AuthScreen({ tagline, title, description, children, footer }: AuthScreenProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-accent/10 to-accent/16 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Brand tagline={tagline} size={44} />
        </div>

        <div className="rounded-xl border border-line bg-panel p-6 shadow-raised sm:p-8">
          <div className="mb-6">
            <h1 className="text-xl font-bold tracking-tight text-ink">{title}</h1>
            {description ? (
              <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>
            ) : null}
          </div>
          {children}
        </div>

        {footer ? <div className="mt-6 text-center text-sm text-muted">{footer}</div> : null}
      </div>
    </div>
  );
}
