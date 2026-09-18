import { describe, expect, it } from "vitest";

import { buildTerminalTheme } from "./theme.ts";

/** Echoes the variable name back, so a mapping mistake is visible as one. */
const echo = (variable: string) => variable;

describe("buildTerminalTheme", () => {
  const theme = buildTerminalTheme(echo);

  it("maps every ANSI slot to its own variable", () => {
    expect(theme.black).toBe("--term-black");
    expect(theme.red).toBe("--term-red");
    expect(theme.green).toBe("--term-green");
    expect(theme.yellow).toBe("--term-yellow");
    expect(theme.blue).toBe("--term-blue");
    expect(theme.magenta).toBe("--term-magenta");
    expect(theme.cyan).toBe("--term-cyan");
    expect(theme.white).toBe("--term-white");
  });

  it("maps the bright row to the bright variables", () => {
    expect(theme.brightBlack).toBe("--term-bright-black");
    expect(theme.brightRed).toBe("--term-bright-red");
    expect(theme.brightGreen).toBe("--term-bright-green");
    expect(theme.brightYellow).toBe("--term-bright-yellow");
    expect(theme.brightBlue).toBe("--term-bright-blue");
    expect(theme.brightMagenta).toBe("--term-bright-magenta");
    expect(theme.brightCyan).toBe("--term-bright-cyan");
    expect(theme.brightWhite).toBe("--term-bright-white");
  });

  it("fills the non-ANSI slots", () => {
    expect(theme.background).toBe("--term-bg");
    expect(theme.foreground).toBe("--term-fg");
    expect(theme.cursor).toBe("--term-cursor");
    expect(theme.selectionBackground).toBe("--term-selection");
  });

  it("gives every slot a distinct colour, so nothing is silently duplicated", () => {
    const ansi = [
      theme.black,
      theme.red,
      theme.green,
      theme.yellow,
      theme.blue,
      theme.magenta,
      theme.cyan,
      theme.white,
      theme.brightBlack,
      theme.brightRed,
      theme.brightGreen,
      theme.brightYellow,
      theme.brightBlue,
      theme.brightMagenta,
      theme.brightCyan,
      theme.brightWhite,
    ];
    expect(new Set(ansi).size).toBe(16);
  });

  it("falls back when a variable is missing, rather than rendering nothing", () => {
    const missing = buildTerminalTheme((_variable, fallback) => fallback);
    expect(missing.background).toMatch(/^#[0-9a-f]{6}$/);
    expect(missing.red).toMatch(/^#[0-9a-f]{6}$/);
  });
});
