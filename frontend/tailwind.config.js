/** @type {import('tailwindcss').Config} */

/**
 * Wraps a token triplet from index.css so Tailwind can apply its own alpha to
 * it. This is what makes `bg-danger/12` and `ring-accent/35` work against a
 * theme-aware colour.
 */
const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  // The theme is driven by `data-theme` on <html>; the `dark` class is toggled
  // alongside it so `dark:` variants stay available where a token is not enough.
  darkMode: "class",
  safelist: [
    // Composed at runtime from lead status and call outcome, so not every
    // combination appears literally in the source for the scanner to find.
    "bg-accent/12",
    "bg-success/12",
    "bg-warning/12",
    "bg-danger/12",
    "bg-info/12",
    "bg-alt/12",
    "bg-steel/20",
  ],
  theme: {
    /*
     * The type scale, the radius scale and the shadow scale are replaced rather
     * extended, for the same reason the colour palette is: a default that is
     * still available is a default that will be used.
     *
     * Before this, the app had seven arbitrary pixel font sizes across 123
     * declarations -- including 13.5px and 10.5px -- eight corner radii, and five
     * stock shadows that are absolute black and so look like a hole punched in
     * the page in light mode while vanishing in dark. Inconsistent type and
     * corner radii are the two things a reader notices without being able to
     * name, which is exactly what "looks unprofessional" usually means.
     *
     * Every size is rem-based, so the density control still scales all of them.
     */
    fontSize: {
      // 11px — uppercase pane titles, table headers, hotkey hints, timestamps.
      "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.01em" }],
      // 12px — secondary meta, chips, helper text.
      xs: ["0.75rem", { lineHeight: "1.125rem" }],
      // 13px — the working size: dense rows, form controls, body copy.
      sm: ["0.8125rem", { lineHeight: "1.25rem" }],
      // 14px — emphasised body, lead-in text.
      base: ["0.875rem", { lineHeight: "1.375rem" }],
      // 16px — card and section headings.
      lg: ["1rem", { lineHeight: "1.5rem" }],
      // 18px — page sub-headings, hero numbers.
      xl: ["1.125rem", { lineHeight: "1.625rem", letterSpacing: "-0.005em" }],
      // 22px — page titles.
      "2xl": ["1.375rem", { lineHeight: "1.75rem", letterSpacing: "-0.015em" }],
      // 28px — the sign-in wordmark, the largest text in the product.
      "3xl": ["1.75rem", { lineHeight: "2.125rem", letterSpacing: "-0.02em" }],
    },

    /*
     * Four radii and a pill. `md` and `2xl` are gone rather than aliased: an
     * alias would let the off-scale names keep working and the scale would drift
     * again within a month.
     */
    borderRadius: {
      none: "0",
      // 4px — chips, hotkey hints, small inline elements.
      sm: "0.25rem",
      // 6px — inputs, menu items, table cells.
      DEFAULT: "0.375rem",
      // 8px — buttons, list rows, popovers.
      lg: "0.5rem",
      // 12px — cards, panes, dialogs. One radius for every large surface.
      xl: "0.75rem",
      full: "9999px",
    },

    /*
     * Three elevations, all theme-aware. The stock scale had five, and none of
     * them changed between light and dark.
     */
    boxShadow: {
      none: "none",
      panel: "var(--shadow-panel)",
      raised: "var(--shadow-raised)",
      floating: "var(--shadow-floating)",
    },

    /*
     * The stock palette is replaced rather than extended on purpose. With
     * `gray-500` and `blue-600` still available, off-token colours creep back in
     * one utility at a time and the themes stop matching.
     *
     * `white` and `black` are gone too. They were kept for scrims and
     * text-on-accent, but `overlay` and `inverse` cover both, and keeping them
     * meant 26 `text-white` and 11 `bg-black/50` survived the token migration —
     * absolute colours that ignore the theme entirely.
     */
    colors: {
      transparent: "transparent",
      current: "currentColor",

      app: token("app"),
      panel: token("panel"),
      raised: token("raised"),
      inset: token("inset"),
      hover: token("hover"),
      overlay: token("overlay"),

      line: token("line"),
      "line-strong": token("line-strong"),

      ink: token("ink"),
      muted: token("muted"),
      faint: token("faint"),
      inverse: token("inverse"),

      accent: {
        DEFAULT: token("accent"),
        strong: token("accent-strong"),
      },

      success: token("success"),
      warning: token("warning"),
      danger: token("danger"),
      info: token("info"),
      alt: token("alt"),

      steel: {
        DEFAULT: token("steel"),
        strong: token("steel-strong"),
      },
    },
    extend: {
      /*
       * Tailwind's default opacity scale only has multiples of five, and a
       * modifier outside it compiles to nothing at all rather than failing --
       * which is how ~80 chip and highlight backgrounds can silently vanish.
       * These tint weights are part of the system, so they are declared here.
       */
      opacity: {
        12: "0.12",
        14: "0.14",
        16: "0.16",
      },
      borderColor: {
        // `border` with no colour argument should mean the standard hairline,
        // in both themes.
        DEFAULT: token("line"),
      },
      ringColor: {
        DEFAULT: token("accent"),
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      /*
       * Motion is part of the system rather than a per-component choice, so the
       * easing and durations are declared once. Everything here is short: the
       * app is a dialer, and an agent working a queue should never wait on an
       * animation. `prefers-reduced-motion` collapses all of it (index.css).
       */
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "rise-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.97)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        // A ringing call has to be noticeable without being alarming.
        "ring-pulse": {
          "0%": { boxShadow: "0 0 0 0 rgb(var(--c-success) / 0.5)" },
          "70%": { boxShadow: "0 0 0 8px rgb(var(--c-success) / 0)" },
          "100%": { boxShadow: "0 0 0 0 rgb(var(--c-success) / 0)" },
        },
        shimmer: {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        "fade-in": "fade-in 140ms ease-out both",
        "rise-in": "rise-in 200ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "scale-in": "scale-in 150ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "ring-pulse": "ring-pulse 1.8s ease-out infinite",
        shimmer: "shimmer 1.6s linear infinite",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
};
