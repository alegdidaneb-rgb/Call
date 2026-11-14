import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_PREFERENCES,
  applyPreferences,
  loadPreferences,
  nextThemeMode,
  resolveTheme,
  savePreferences,
  type Density,
  type Preferences,
  type ResolvedTheme,
  type ThemeMode,
} from "@/lib/preferences";

interface PreferencesContextValue {
  /** What the agent asked for, which may be "system". */
  theme: ThemeMode;
  /** What is actually on screen right now. */
  resolvedTheme: ResolvedTheme;
  density: Density;
  setTheme: (theme: ThemeMode) => void;
  setDensity: (density: Density) => void;
  /** Cycles dark -> light -> system. */
  cycleTheme: () => void;
  toggleDensity: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue>({
  theme: DEFAULT_PREFERENCES.theme,
  resolvedTheme: "dark",
  density: DEFAULT_PREFERENCES.density,
  setTheme: () => undefined,
  setDensity: () => undefined,
  cycleTheme: () => undefined,
  toggleDensity: () => undefined,
});

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(loadPreferences);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(prefs.theme));

  // Push every change to <html> and to storage in one place, so no caller can
  // update one without the other.
  useEffect(() => {
    setResolvedTheme(applyPreferences(prefs));
    savePreferences(prefs);
  }, [prefs]);

  // While the agent has asked for "system", follow the OS live rather than only
  // at load time.
  useEffect(() => {
    if (prefs.theme !== "system" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const handleChange = () => setResolvedTheme(applyPreferences(prefs));
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, [prefs]);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      theme: prefs.theme,
      resolvedTheme,
      density: prefs.density,
      setTheme: (theme) => setPrefs((previous) => ({ ...previous, theme })),
      setDensity: (density) => setPrefs((previous) => ({ ...previous, density })),
      cycleTheme: () => setPrefs((previous) => ({ ...previous, theme: nextThemeMode(previous.theme) })),
      toggleDensity: () =>
        setPrefs((previous) => ({
          ...previous,
          density: previous.density === "compact" ? "comfortable" : "compact",
        })),
    }),
    [prefs.theme, prefs.density, resolvedTheme],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  return useContext(PreferencesContext);
}
