/**
 * The last N bytes of a session's output, for replay after a reattach.
 *
 * Bounded in bytes rather than lines, because a terminal stream has no lines -
 * a full-screen `htop` redraw is one enormous "line" and a counter of them
 * bounds nothing.
 *
 * Eviction drops whole chunks down to one that begins at a boundary the scanner
 * vouched for, and trims inside the last surviving chunk when even that is not
 * enough, so replay never starts in the middle of an escape sequence or a UTF-8
 * code point. Recording one flag and one offset per chunk on the way past is
 * what keeps this O(1) per append rather than a rescan on every eviction.
 *
 * The limitation worth knowing: replay is a byte tail, not a terminal state.
 * If the evicted prefix switched to the alternate screen or set a mode, the
 * replayed bytes alone will not put the terminal back in it. A generous
 * capacity makes that rare; pretending to emulate a terminal here would not
 * make it right.
 */
import { TerminalStreamScanner } from "./streamScanner.ts";

interface Chunk {
  readonly bytes: Uint8Array;
  /** Whether the stream was at a safe boundary immediately before this chunk. */
  readonly startsSafe: boolean;
  /**
   * The first offset inside this chunk a replay could start from, or null if
   * the whole chunk is one long sequence. Recorded on the way past so the last
   * surviving chunk can be trimmed rather than kept whole and unsafe.
   */
  readonly firstSafeOffset: number | null;
}

export class OutputRingBuffer {
  private readonly chunks: Chunk[] = [];
  private readonly scanner = new TerminalStreamScanner();
  private bytes = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  /** Total bytes currently retained. */
  get size(): number {
    return this.bytes;
  }

  append(chunk: Uint8Array): void {
    if (chunk.length === 0) return;

    const startsSafe = this.scanner.atBoundary;
    let firstSafeOffset: number | null = startsSafe ? 0 : null;
    for (let i = 0; i < chunk.length; i += 1) {
      const byte = chunk[i];
      if (byte === undefined) break;
      // Checked before the byte is consumed, so the offset names the position
      // in front of it.
      if (firstSafeOffset === null && this.scanner.atBoundary) firstSafeOffset = i;
      this.scanner.feed(byte);
    }

    this.chunks.push({ bytes: chunk, startsSafe, firstSafeOffset });
    this.bytes += chunk.length;
    this.evict();
  }

  /**
   * Everything retained, as one buffer.
   *
   * Joined here rather than emitted chunk by chunk so a reattach is a single
   * write: the terminal parses one contiguous stream instead of rendering a
   * flicker of partial frames.
   */
  snapshot(): Uint8Array {
    const out = new Uint8Array(this.bytes);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk.bytes, offset);
      offset += chunk.bytes.length;
    }
    return out;
  }

  clear(): void {
    this.chunks.length = 0;
    this.bytes = 0;
  }

  private evict(): void {
    // Stop once we are within capacity and the chunk that would begin a replay
    // is one the scanner vouched for. An unsafe head is dropped even when we
    // are already small enough, because starting a replay there would emit a
    // half escape sequence.
    while (this.chunks.length > 1) {
      const head = this.chunks[0];
      if (head === undefined) return;
      if (this.bytes <= this.capacity && head.startsSafe) return;
      this.chunks.shift();
      this.bytes -= head.bytes.length;
    }

    // One chunk left, and it is never dropped - something is better than
    // nothing. But it may be a chunk we landed on mid-sequence, which happens
    // whenever a driver's reads are large next to the capacity. Cut it forward
    // to the first offset a replay can start from instead of keeping it whole
    // and corrupt. A chunk with no safe offset anywhere is one unbroken
    // sequence, and there is nothing better to do with it.
    const only = this.chunks[0];
    if (only === undefined || only.startsSafe) return;
    if (only.firstSafeOffset === null || only.firstSafeOffset === 0) return;
    this.chunks[0] = {
      bytes: only.bytes.subarray(only.firstSafeOffset),
      startsSafe: true,
      firstSafeOffset: 0,
    };
    this.bytes -= only.firstSafeOffset;
  }
}
