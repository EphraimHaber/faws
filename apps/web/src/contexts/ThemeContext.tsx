import * as React from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "faws:theme";

interface ThemeValue {
  readonly theme: Theme;
  toggle(): void;
}

const ThemeContext = React.createContext<ThemeValue | null>(null);

function initialTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* fall through to the media query */
  }
  // Dark-first: this tool lives next to a terminal.
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = React.useState<Theme>(initialTheme);

  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.add("no-transitions");
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* storage blocked */
    }
    const id = window.setTimeout(() => root.classList.remove("no-transitions"), 0);
    return () => window.clearTimeout(id);
  }, [theme]);

  const value = React.useMemo<ThemeValue>(
    () => ({ theme, toggle: () => setTheme((prev) => (prev === "dark" ? "light" : "dark")) }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = React.useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside <ThemeProvider>");
  return value;
}
