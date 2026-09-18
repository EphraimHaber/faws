import { describe, expect, it } from "vitest";

import { OutputRingBuffer } from "./ringBuffer.ts";
import { TerminalStreamScanner } from "./streamScanner.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function write(buffer: OutputRingBuffer, text: string): void {
  buffer.append(encoder.encode(text));
}

function read(buffer: OutputRingBuffer): string {
  return decoder.decode(buffer.snapshot());
}

/**
 * Whether a replay of this snapshot would begin mid-sequence.
 *
 * A snapshot is safe to start from when its first byte is something a terminal
 * in its initial state can read: plain text, or the start of a sequence. A
 * UTF-8 continuation byte means the code point that owned it was cut.
 */
function startsAtBoundary(bytes: Uint8Array): boolean {
  const first = bytes[0];
  if (first === undefined) return true;
  if ((first & 0xc0) === 0x80) return false;
  const scanner = new TerminalStreamScanner();
  scanner.feed(first);
  return true;
}

describe("retention", () => {
  it("keeps everything while under capacity", () => {
    const buffer = new OutputRingBuffer(1024);
    write(buffer, "one");
    write(buffer, "two");
    expect(read(buffer)).toBe("onetwo");
    expect(buffer.size).toBe(6);
  });

  it("drops the oldest chunks once over capacity", () => {
    const buffer = new OutputRingBuffer(10);
    write(buffer, "aaaaa");
    write(buffer, "bbbbb");
    write(buffer, "ccccc");
    expect(read(buffer)).toBe("bbbbbccccc");
    expect(buffer.size).toBe(10);
  });

  it("ignores an empty append", () => {
    const buffer = new OutputRingBuffer(10);
    buffer.append(new Uint8Array(0));
    expect(buffer.size).toBe(0);
  });

  it("clears", () => {
    const buffer = new OutputRingBuffer(10);
    write(buffer, "abc");
    buffer.clear();
    expect(buffer.size).toBe(0);
    expect(read(buffer)).toBe("");
  });

  it("keeps a single chunk larger than the capacity rather than nothing", () => {
    const buffer = new OutputRingBuffer(4);
    write(buffer, "a much longer chunk than the capacity");
    expect(read(buffer)).toBe("a much longer chunk than the capacity");
  });
});

describe("escape-sequence boundaries", () => {
  it("never begins a replay inside a CSI sequence", () => {
    const buffer = new OutputRingBuffer(12);
    // The chunk boundary falls in the middle of the colour sequence.
    write(buffer, "aaaaaaaaaa");
    write(buffer, "\u001b[3");
    write(buffer, "1mred");
    // Starting at "1mred" would print "1mred" as text; the unsafe chunk is
    // dropped instead.
    expect(read(buffer)).not.toMatch(/^1m/);
    expect(startsAtBoundary(buffer.snapshot())).toBe(true);
  });

  it("never begins a replay inside a multi-byte code point", () => {
    const buffer = new OutputRingBuffer(8);
    write(buffer, "aaaaaaaa");
    // Split a two-byte code point across two appends.
    buffer.append(new Uint8Array([0xc3]));
    buffer.append(new Uint8Array([0xa9, 0x21]));
    expect(startsAtBoundary(buffer.snapshot())).toBe(true);
  });

  it("keeps a chunk that starts cleanly after a completed sequence", () => {
    const buffer = new OutputRingBuffer(8);
    write(buffer, "\u001b[31mred\u001b[0m");
    write(buffer, "plain");
    expect(read(buffer)).toBe("plain");
  });

  it("holds the boundary across many read splits", () => {
    const source =
      "\u001b[2m12:00\u001b[0m \u001b[32mINFO\u001b[0m ready \u2500\u2500 caf\u00e9 \u001b]0;t\u0007 done\r\n";
    const bytes = encoder.encode(source.repeat(20));

    for (let split = 1; split < 40; split += 1) {
      const buffer = new OutputRingBuffer(64);
      for (let i = 0; i < bytes.length; i += split) {
        buffer.append(bytes.slice(i, i + split));
      }
      expect(startsAtBoundary(buffer.snapshot())).toBe(true);
    }
  });
});

describe("snapshot", () => {
  it("joins chunks into one contiguous buffer", () => {
    const buffer = new OutputRingBuffer(1024);
    write(buffer, "abc");
    write(buffer, "def");
    const snapshot = buffer.snapshot();
    expect(snapshot).toBeInstanceOf(Uint8Array);
    expect(snapshot.length).toBe(6);
    expect(decoder.decode(snapshot)).toBe("abcdef");
  });

  it("does not alias the retained chunks", () => {
    const buffer = new OutputRingBuffer(1024);
    write(buffer, "abc");
    const snapshot = buffer.snapshot();
    snapshot[0] = 0x7a;
    expect(read(buffer)).toBe("abc");
  });
});
