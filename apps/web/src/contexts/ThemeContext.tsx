import type { Theme } from "@faws/contracts";
import * as React from "react";

import { updateSettings, useSettings } from "~/stores/settings";

/**
 * The colour scheme, as the server has it.
 *
 * The provider no longer holds the value - `useSettings` does, so the setting
 * follows the person between the browser and the desktop app. What stays here
 * is the part that is genuinely about this document: putting the class on
 * `<html>` and suppressing transitions while it changes.
 *
 * First paint is handled before React exists, by the inline script in
 * `index.html` (or the copy the server injects). This effect is what keeps the
 * document in step afterwards, including when the change came from another
 * window.
 */
interface ThemeValue {
  readonly theme: Theme;
  toggle(): void;
}

const ThemeContext = React.createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSettings((state) => state.settings.appearance.theme);

  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.add("no-transitions");
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
    const id = window.setTimeout(() => root.classList.remove("no-transitions"), 0);
    return () => window.clearTimeout(id);
  }, [theme]);

  const value = React.useMemo<ThemeValue>(
    () => ({
      theme,
      toggle: () => updateSettings({ appearance: { theme: theme === "dark" ? "light" : "dark" } }),
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = React.useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside <ThemeProvider>");
  return value;
}
