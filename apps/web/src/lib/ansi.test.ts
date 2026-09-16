import { describe, expect, it } from "vitest";

import { hasAnsi, parseAnsi, stripAnsi } from "./ansi.ts";

const ESC = "\u001B";

// A real line from Rust's `tracing`, which brackets almost every token.
const TRACING_LINE = `${ESC}[2m2026-09-16T08:53:07.545915Z${ESC}[0m ${ESC}[32m INFO${ESC}[0m ${ESC}[2mapp_core::s3${ESC}[0m${ESC}[2m:${ESC}[0m pushed config to s3`;

describe("parseAnsi", () => {
  it("keeps the text and drops the escapes", () => {
    const text = parseAnsi(TRACING_LINE)
      .map((span) => span.text)
      .join("");
    expect(text).toBe("2026-09-16T08:53:07.545915Z  INFO app_core::s3: pushed config to s3");
    expect(text).not.toContain(ESC);
  });

  it("styles each run according to the code that opened it", () => {
    const spans = parseAnsi(TRACING_LINE);
    expect(spans[0]).toEqual({
      text: "2026-09-16T08:53:07.545915Z",
      className: "text-muted-foreground/70",
    });
    expect(spans.find((span) => span.text === " INFO")?.className).toBe("text-success");
  });

  it("resets back to unstyled text", () => {
    const spans = parseAnsi(`${ESC}[31mred${ESC}[0mplain`);
    expect(spans).toEqual([
      { text: "red", className: "text-danger" },
      { text: "plain", className: "" },
    ]);
  });

  it("merges adjacent runs that would render identically", () => {
    // Two resets in a row shouldn't produce two empty-class spans.
    const spans = parseAnsi(`a${ESC}[0m${ESC}[0mb`);
    expect(spans).toEqual([{ text: "ab", className: "" }]);
  });

  it("combines attributes and honours the targeted resets", () => {
    const [bold] = parseAnsi(`${ESC}[1;4;31mx`);
    expect(bold?.className).toContain("font-semibold");
    expect(bold?.className).toContain("underline");
    expect(bold?.className).toContain("text-danger");

    const spans = parseAnsi(`${ESC}[1mbold${ESC}[22mnormal`);
    expect(spans[1]?.className).toBe("");
  });

  it("treats a bare ESC[m as a full reset", () => {
    const spans = parseAnsi(`${ESC}[31mred${ESC}[mplain`);
    expect(spans[1]?.className).toBe("");
  });

  it("strips non-SGR sequences without styling anything", () => {
    expect(parseAnsi(`${ESC}[2Kcleared`)).toEqual([{ text: "cleared", className: "" }]);
  });

  it("passes plain text through as a single span", () => {
    expect(parseAnsi("nothing special")).toEqual([{ text: "nothing special", className: "" }]);
  });
});

describe("stripAnsi", () => {
  it("leaves only the readable text", () => {
    expect(stripAnsi(TRACING_LINE)).toBe(
      "2026-09-16T08:53:07.545915Z  INFO app_core::s3: pushed config to s3",
    );
  });
});

describe("hasAnsi", () => {
  it("detects escapes", () => {
    expect(hasAnsi(TRACING_LINE)).toBe(true);
    expect(hasAnsi("plain line")).toBe(false);
  });
});
