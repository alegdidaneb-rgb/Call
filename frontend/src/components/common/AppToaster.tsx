import { Toaster } from "react-hot-toast";

/**
 * The app-wide toast host, styled from the same tokens as every other surface.
 *
 * react-hot-toast's default is a white pill with dark text and a drop shadow.
 * Mounted unstyled in a dark app it reads as a browser artefact that escaped the
 * design system — and because it is rendered outside the React tree by a portal,
 * it is easy to forget it is there at all. These styles pull the live CSS
 * variables, so a toast follows the theme, and follows it immediately when the
 * agent switches, because the variables resolve at paint time rather than at
 * mount.
 */
export function AppToaster() {
  return (
    <Toaster
      position="bottom-right"
      gutter={10}
      toastOptions={{
        duration: 5000,
        style: {
          background: "rgb(var(--c-raised))",
          color: "rgb(var(--c-ink))",
          border: "1px solid rgb(var(--c-line-strong))",
          borderRadius: "0.625rem",
          boxShadow: "var(--shadow-floating)",
          fontSize: "0.8125rem",
          fontWeight: 500,
          lineHeight: 1.45,
          padding: "0.625rem 0.875rem",
          maxWidth: "26rem",
        },
        success: {
          iconTheme: {
            primary: "rgb(var(--c-success))",
            secondary: "rgb(var(--c-raised))",
          },
        },
        error: {
          // A failure needs longer to read than a confirmation does, and it is
          // usually the thing the agent has to act on.
          duration: 8000,
          iconTheme: {
            primary: "rgb(var(--c-danger))",
            secondary: "rgb(var(--c-raised))",
          },
        },
      }}
    />
  );
}
