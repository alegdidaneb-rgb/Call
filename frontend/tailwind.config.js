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
     * The stock palette is replaced rather than extended on purpose. With
     * `gray-500` and `blue-600` still available, off-token colours creep back
     * in one utility at a time and the themes stop matching. `white` and
     * `black` stay because scrims and text-on-accent are genuinely absolute.
     */
    colors: {
      transparent: "transparent",
      current: "currentColor",
      white: "#ffffff",
      black: "#000000",

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
      boxShadow: {
        panel: "var(--shadow-panel)",
        raised: "var(--shadow-raised)",
        floating: "var(--shadow-floating)",
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
