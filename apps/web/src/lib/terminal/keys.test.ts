import { describe, expect, it } from "vitest";

import { isAppChord, type KeyEventLike, type Platform } from "./keys.ts";

function key(partial: Partial<KeyEventLike> & { key: string }): KeyEventLike {
  return { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...partial };
}

/** Reads as "on mac, does the app take Cmd+K?" */
function appTakes(platform: Platform, partial: Partial<KeyEventLike> & { key: string }): boolean {
  return isAppChord(key(partial), platform);
}

describe("the shell keeps what a shell needs", () => {
  const shellChords = [
    { key: "c", ctrlKey: true, what: "interrupt" },
    { key: "d", ctrlKey: true, what: "end of input" },
    { key: "z", ctrlKey: true, what: "suspend" },
    { key: "l", ctrlKey: true, what: "clear" },
    { key: "a", ctrlKey: true, what: "start of line" },
    { key: "e", ctrlKey: true, what: "end of line" },
    { key: "r", ctrlKey: true, what: "reverse search" },
    { key: "u", ctrlKey: true, what: "kill line" },
    { key: "w", ctrlKey: true, what: "kill word" },
    { key: "k", ctrlKey: true, what: "kill to end" },
  ];

  for (const platform of ["mac", "other"] as const) {
    for (const chord of shellChords) {
      it(`${platform}: Ctrl+${chord.key} (${chord.what}) goes to the terminal`, () => {
        const { key: k, ctrlKey } = chord;
        expect(appTakes(platform, { key: k, ctrlKey })).toBe(false);
      });
    }
  }

  it("plain typing goes to the terminal", () => {
    for (const k of ["j", "k", "h", "?", "/", "R", "a", "Escape", "Enter", "Tab"]) {
      expect(appTakes("mac", { key: k })).toBe(false);
      expect(appTakes("other", { key: k })).toBe(false);
    }
  });

  it("arrows and function keys go to the terminal", () => {
    for (const k of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "F2", "F5", "F12"]) {
      expect(appTakes("mac", { key: k })).toBe(false);
      expect(appTakes("other", { key: k })).toBe(false);
    }
  });
});

describe("the escape hatch works everywhere", () => {
  it("Cmd+Escape returns focus to the page on mac", () => {
    expect(appTakes("mac", { key: "Escape", metaKey: true })).toBe(true);
  });

  it("Ctrl+Escape returns focus to the page elsewhere", () => {
    expect(appTakes("other", { key: "Escape", ctrlKey: true })).toBe(true);
  });

  it("without it a focused terminal would be a keyboard trap", () => {
    // Plain Escape must reach vim, so the modified form is the only way out.
    expect(appTakes("other", { key: "Escape" })).toBe(false);
  });
});

describe("the dock's own chords", () => {
  it("Ctrl+backtick toggles the dock on both platforms", () => {
    expect(appTakes("mac", { key: "`", ctrlKey: true })).toBe(true);
    expect(appTakes("other", { key: "`", ctrlKey: true })).toBe(true);
  });

  it("Mod+Alt chords belong to the app on both platforms", () => {
    for (const k of ["t", "w", "f", "[", "]", "Enter"]) {
      expect(appTakes("mac", { key: k, metaKey: true, altKey: true })).toBe(true);
      expect(appTakes("other", { key: k, ctrlKey: true, altKey: true })).toBe(true);
    }
  });

  it("does not claim Mod+Alt for keys it has no binding for", () => {
    expect(appTakes("other", { key: "q", ctrlKey: true, altKey: true })).toBe(false);
  });
});

describe("the platform split", () => {
  it("mac: Cmd+K opens the palette, because no shell binds Cmd", () => {
    expect(appTakes("mac", { key: "k", metaKey: true })).toBe(true);
  });

  it("other: Ctrl+K stays with the terminal, because it is kill-line", () => {
    expect(appTakes("other", { key: "k", ctrlKey: true })).toBe(false);
  });

  it("mac: copy, paste and select-all stay with the terminal", () => {
    for (const k of ["c", "v", "a"]) {
      expect(appTakes("mac", { key: k, metaKey: true })).toBe(false);
    }
  });

  it("other: Ctrl+Shift+C is the terminal's copy convention", () => {
    expect(appTakes("other", { key: "C", ctrlKey: true, shiftKey: true })).toBe(false);
  });
});
