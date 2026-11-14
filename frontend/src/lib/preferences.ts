/**
 * Appearance preferences.
 *
 * Deliberately framework-free so `index.html` can apply the same defaults
 * before first paint and so the logic can be reasoned about without React.
 */

export type ThemeMode = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";
export type Density = "comfortable" | "compact";

export interface Preferences {
  theme: ThemeMode;
  density: Density;
}

/** Shared with the pre-paint script in `index.html`. */
export const STORAGE_KEY = "cold-dialer-prefs";

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "dark",
  density: "comfortable",
};

export const THEME_MODES: ThemeMode[] = ["dark", "light", "system"];

/** Collapses "system" to whichever theme the OS is currently using. */
export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode !== "system") return mode;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "dark" || value === "light" || value === "system";
}

/**
 * Reads stored preferences, falling back to the defaults for anything absent or
 * corrupt. A malformed entry must never stop the app from booting.
 */
export function loadPreferences(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      theme: isThemeMode(parsed.theme) ? parsed.theme : DEFAULT_PREFERENCES.theme,
      density: parsed.density === "compact" ? "compact" : "comfortable",
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(prefs: Preferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Private browsing and full storage both throw here. The theme still
    // applies for this session, which is the part the agent can see.
  }
}

/**
 * Writes the preferences onto `<html>`, where `index.css` reads them.
 * Returns the resolved theme so callers can react without resolving twice.
 */
export function applyPreferences(prefs: Preferences): ResolvedTheme {
  const resolved = resolveTheme(prefs.theme);
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.setAttribute("data-theme", resolved);
    root.classList.toggle("dark", resolved === "dark");
    root.setAttribute("data-density", prefs.density);
  }
  return resolved;
}

/** Dark -> light -> system, for the single-button control in the top bar. */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  const index = THEME_MODES.indexOf(mode);
  return THEME_MODES[(index + 1) % THEME_MODES.length];
}
