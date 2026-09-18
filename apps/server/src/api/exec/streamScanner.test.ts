import { describe, expect, it } from "vitest";

import { TerminalStreamScanner } from "./streamScanner.ts";

const encoder = new TextEncoder();

/** Boundary state after feeding every byte of `text`. */
function boundaryAfter(text: string): boolean {
  const scanner = new TerminalStreamScanner();
  for (const byte of encoder.encode(text)) scanner.feed(byte);
  return scanner.atBoundary;
}

/** Boundary state after each byte, as "." for safe and "x" for not. */
function trace(text: string): string {
  const scanner = new TerminalStreamScanner();
  let out = "";
  for (const byte of encoder.encode(text)) {
    scanner.feed(byte);
    out += scanner.atBoundary ? "." : "x";
  }
  return out;
}

describe("plain text", () => {
  it("is a boundary at every byte", () => {
    expect(trace("hello")).toBe(".....");
  });

  it("starts at a boundary", () => {
    expect(new TerminalStreamScanner().atBoundary).toBe(true);
  });
});

describe("CSI sequences", () => {
  it("is unsafe from the ESC until the final byte", () => {
    // ESC [ 3 1 m - set foreground red
    expect(trace("\u001b[31m")).toBe("xxxx.");
  });

  it("handles a sequence with no parameters", () => {
    expect(trace("\u001b[H")).toBe("xx.");
  });

  it("handles multi-parameter sequences", () => {
    expect(boundaryAfter("\u001b[1;31;42m")).toBe(true);
    expect(boundaryAfter("\u001b[1;31;42")).toBe(false);
  });

  it("returns to text after the sequence", () => {
    expect(trace("\u001b[0mok")).toBe("xxx...");
  });
});

describe("OSC and other string sequences", () => {
  it("runs to a BEL", () => {
    expect(boundaryAfter("\u001b]0;title\u0007")).toBe(true);
    expect(boundaryAfter("\u001b]0;title")).toBe(false);
  });

  it("runs to a String Terminator", () => {
    expect(boundaryAfter("\u001b]0;title\u001b\\")).toBe(true);
  });

  it("does not end on an ESC that is not a terminator", () => {
    expect(boundaryAfter("\u001b]0;ti\u001btle")).toBe(false);
  });

  it("treats DCS as a string sequence", () => {
    expect(boundaryAfter("\u001bPsomething")).toBe(false);
    expect(boundaryAfter("\u001bPsomething\u001b\\")).toBe(true);
  });

  it("ignores a semicolon-heavy OSC payload", () => {
    expect(boundaryAfter("\u001b]8;;https://example.com\u0007")).toBe(true);
  });
});

describe("two-byte escapes", () => {
  it("ends immediately", () => {
    // ESC 7 - save cursor
    expect(trace("\u001b7")).toBe("x.");
  });
});

describe("UTF-8", () => {
  it("is unsafe until the code point completes", () => {
    // Two bytes
    expect(trace("é")).toBe("x.");
  });

  it("handles a three-byte code point", () => {
    // A box-drawing character
    expect(trace("─")).toBe("xx.");
  });

  it("handles a four-byte code point", () => {
    expect(trace("\u{1f600}")).toBe("xxx.");
  });

  it("resynchronises when a code point is truncated", () => {
    const scanner = new TerminalStreamScanner();
    scanner.feed(0xc3); // lead byte promising one continuation
    expect(scanner.atBoundary).toBe(false);
    scanner.feed(0x41); // an "A" instead - the code point was cut short
    expect(scanner.atBoundary).toBe(true);
  });

  it("ignores a stray continuation byte", () => {
    const scanner = new TerminalStreamScanner();
    scanner.feed(0x80);
    expect(scanner.atBoundary).toBe(true);
  });
});

describe("realistic output", () => {
  it("ends at a boundary after a coloured log line", () => {
    expect(boundaryAfter("\u001b[2m10:04\u001b[0m \u001b[32mINFO\u001b[0m ready\r\n")).toBe(true);
  });

  it("ends mid-sequence when output is cut by a read boundary", () => {
    expect(boundaryAfter("ready\r\n\u001b[3")).toBe(false);
  });
});
