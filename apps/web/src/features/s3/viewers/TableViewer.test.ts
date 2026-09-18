import { describe, expect, it } from "vitest";

import { parseDelimited, parseJsonLines } from "./TableViewer.tsx";

describe("parseDelimited", () => {
  it("takes the first line as the header", () => {
    const parsed = parseDelimited("name,size\napp.json,12\n");
    expect(parsed.headers).toEqual(["name", "size"]);
    expect(parsed.rows).toEqual([["app.json", "12"]]);
  });

  it("prefers tabs when the first line has more of them", () => {
    const parsed = parseDelimited("a\tb\tc,d\n1\t2\t3,4\n");
    expect(parsed.headers).toEqual(["a", "b", "c,d"]);
  });

  it("keeps commas when they are the more common separator", () => {
    const parsed = parseDelimited("a\tb,c\n1\t2,3\n");
    expect(parsed.headers).toEqual(["a\tb", "c"]);
  });

  it("keeps a delimiter inside a quoted field", () => {
    const parsed = parseDelimited('name,note\n"a,b",plain\n');
    expect(parsed.rows).toEqual([["a,b", "plain"]]);
  });

  it("reads a doubled quote as one literal quote", () => {
    const parsed = parseDelimited('v\n"say ""hi"""\n');
    expect(parsed.rows).toEqual([['say "hi"']]);
  });

  it("names the columns a header line is missing", () => {
    const parsed = parseDelimited("a\n1,2,3\n");
    expect(parsed.headers).toEqual(["a", "col 2", "col 3"]);
  });

  it("flags text that stops mid record, as a fetched slice does", () => {
    expect(parseDelimited("a,b\n1,2\n3,4").truncatedLine).toBe(true);
    expect(parseDelimited("a,b\n1,2\n").truncatedLine).toBe(false);
  });
});

describe("parseJsonLines", () => {
  it("collects columns across every record, not just the first", () => {
    const parsed = parseJsonLines('{"a":1}\n{"b":2}\n');
    expect(parsed.headers).toEqual(["a", "b"]);
    expect(parsed.rows).toEqual([
      ["1", ""],
      ["", "2"],
    ]);
  });

  it("renders a nested value as its JSON", () => {
    const parsed = parseJsonLines('{"a":{"deep":true}}\n');
    expect(parsed.rows).toEqual([['{"deep":true}']]);
  });

  it("wraps a bare value so it still has a column", () => {
    const parsed = parseJsonLines("42\n");
    expect(parsed.headers).toEqual(["value"]);
    expect(parsed.rows).toEqual([["42"]]);
  });

  it("drops a trailing partial line and says so", () => {
    const parsed = parseJsonLines('{"a":1}\n{"a":2');
    expect(parsed.rows).toEqual([["1"]]);
    expect(parsed.truncatedLine).toBe(true);
  });

  it("skips a broken record in the middle without failing the rest", () => {
    const parsed = parseJsonLines('{"a":1}\nnot json\n{"a":3}\n');
    expect(parsed.rows).toEqual([["1"], ["3"]]);
    expect(parsed.truncatedLine).toBe(false);
  });
});
