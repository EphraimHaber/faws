import { describe, expect, it } from "vitest";

import { parseJsonLine, tokenize } from "./json-log.ts";

const LINE = '{"level":30,"msg":"commands publish","ok":true,"err":null,"n":1.5e3}';

describe("parseJsonLine", () => {
  it("tokenises a structured line", () => {
    const parsed = parseJsonLine(LINE);
    expect(parsed).not.toBeNull();
    const kinds = Object.fromEntries(
      (parsed?.tokens ?? [])
        .filter((token) => token.kind !== "punctuation" && token.kind !== "whitespace")
        .map((token) => [token.text, token.kind]),
    );
    expect(kinds).toEqual({
      '"level"': "key",
      "30": "number",
      '"msg"': "key",
      '"commands publish"': "string",
      '"ok"': "key",
      true: "boolean",
      '"err"': "key",
      null: "null",
      '"n"': "key",
      "1.5e3": "number",
    });
  });

  it("keeps a prefix the runtime wrote before the JSON", () => {
    const parsed = parseJsonLine('2026-09-16T08:53:07Z INFO {"msg":"hi"}');
    expect(parsed?.prefix).toBe("2026-09-16T08:53:07Z INFO ");
    expect(parsed?.value).toEqual({ msg: "hi" });
  });

  it("round-trips: the tokens reassemble into the original payload", () => {
    const parsed = parseJsonLine(LINE);
    expect((parsed?.tokens ?? []).map((token) => token.text).join("")).toBe(LINE);
  });

  it("refuses lines that merely contain braces", () => {
    expect(parseJsonLine("started worker {not json}")).toBeNull();
    expect(parseJsonLine("plain text line")).toBeNull();
    expect(parseJsonLine('{"unclosed": ')).toBeNull();
  });

  it("refuses scalars, which are not structured logs", () => {
    expect(parseJsonLine("42")).toBeNull();
    expect(parseJsonLine('"just a string"')).toBeNull();
  });

  it("handles arrays and escaped quotes inside strings", () => {
    expect(parseJsonLine('[{"a":1}]')?.value).toEqual([{ a: 1 }]);
    const escaped = parseJsonLine(String.raw`{"msg":"he said \"hi\""}`);
    expect(escaped?.value).toEqual({ msg: 'he said "hi"' });
  });
});

describe("real service output", () => {
  // The shape pino writes: an EC2-style hostname, which is the case that broke
  // plain-text search, and `time` as an epoch rather than a string.
  const PINO = String.raw`{"level":30,"time":1789483208935,"pid":1,"hostname":"ip-10-0-35-107.eu-west-1.compute.internal","endpoint":"https://api.example.com/game/command","msg":"commands publish to the front door"}`;

  it("parses and round-trips it", () => {
    const parsed = parseJsonLine(PINO);
    expect(parsed).not.toBeNull();
    expect(parsed?.prefix).toBe("");
    expect((parsed?.value as { msg?: string } | undefined)?.msg).toBe(
      "commands publish to the front door",
    );
    expect((parsed?.tokens ?? []).map((token) => token.text).join("")).toBe(PINO);
  });

  it("marks the field names as keys and the hostname as a value", () => {
    const tokens = parseJsonLine(PINO)?.tokens ?? [];
    const kind = (text: string) => tokens.find((token) => token.text === text)?.kind;
    expect(kind('"hostname"')).toBe("key");
    expect(kind('"ip-10-0-35-107.eu-west-1.compute.internal"')).toBe("string");
    expect(kind("1789483208935")).toBe("number");
  });
});

describe("tokenize", () => {
  it("distinguishes a key from an identical string value", () => {
    const tokens = tokenize('{"a":"a"}').filter((token) => token.text === '"a"');
    expect(tokens.map((token) => token.kind)).toEqual(["key", "string"]);
  });

  it("treats whitespace as its own token so indentation survives", () => {
    const tokens = tokenize('{\n  "a": 1\n}');
    expect(tokens.map((token) => token.text).join("")).toBe('{\n  "a": 1\n}');
    expect(tokens.some((token) => token.kind === "whitespace")).toBe(true);
  });
});
