/**
 * Tracks where a terminal byte stream can safely be cut.
 *
 * Replay after a reattach starts partway through a stream, and "partway" is not
 * an arbitrary byte: resuming in the middle of `ESC [ 3 1 m` feeds the terminal
 * `1m` as text, and resuming inside a multi-byte UTF-8 run produces a
 * replacement character. Both are visible garbage on the first line the user
 * sees after reconnecting, which is the worst possible moment for it.
 *
 * So the scanner answers one question - after this byte, is the stream back at
 * a boundary where a cut is harmless? - and the ring buffer only ever drops up
 * to a position where the answer was yes.
 *
 * It deliberately understands escape *framing* rather than escape *meaning*: it
 * needs to know where a sequence ends, not what it does.
 */

const ESC = 0x1b;
const BEL = 0x07;
const CSI_INTRODUCER = 0x5b; // [
const OSC_INTRODUCER = 0x5d; // ]
const ST_TERMINATOR = 0x5c; // \  (the second byte of ESC \)

/** DCS, SOS, PM and APC all run until a String Terminator, like OSC does. */
const STRING_INTRODUCERS = new Set([0x50, 0x58, 0x5e, 0x5f]);

type State =
  | "ground"
  /** Seen ESC, waiting for the byte that says which kind of sequence this is. */
  | "escape"
  /** Inside ESC [ ... , which ends at a byte in 0x40-0x7e. */
  | "csi"
  /** Inside a string sequence, which ends at BEL or ESC \. */
  | "string"
  /** Inside a string sequence and just saw an ESC, which may be the ST. */
  | "string-escape"
  /** Part-way through a multi-byte UTF-8 code point. */
  | "utf8";

export class TerminalStreamScanner {
  private state: State = "ground";
  /** Continuation bytes still owed by the UTF-8 code point in progress. */
  private pending = 0;

  /** True when the stream is at a position a cut would not corrupt. */
  get atBoundary(): boolean {
    return this.state === "ground";
  }

  feed(byte: number): void {
    switch (this.state) {
      case "ground":
        this.fromGround(byte);
        return;

      case "escape":
        if (byte === CSI_INTRODUCER) this.state = "csi";
        else if (byte === OSC_INTRODUCER || STRING_INTRODUCERS.has(byte)) this.state = "string";
        // Anything else is a complete two-byte escape (ESC 7, ESC =, ...).
        else this.state = "ground";
        return;

      case "csi":
        // Parameter and intermediate bytes continue the sequence; the first
        // byte in the final range ends it.
        if (byte >= 0x40 && byte <= 0x7e) this.state = "ground";
        return;

      case "string":
        if (byte === BEL) this.state = "ground";
        else if (byte === ESC) this.state = "string-escape";
        return;

      case "string-escape":
        // ESC \ is the String Terminator. An ESC followed by anything else is
        // payload, and the string continues.
        this.state = byte === ST_TERMINATOR ? "ground" : "string";
        return;

      case "utf8":
        // A byte that is not a continuation means the previous code point was
        // truncated; re-read this one as a fresh lead byte rather than swallow
        // it, so a corrupt stream resynchronises instead of cascading.
        if ((byte & 0xc0) === 0x80) {
          this.pending -= 1;
          if (this.pending === 0) this.state = "ground";
          return;
        }
        this.state = "ground";
        this.fromGround(byte);
        return;
    }
  }

  private fromGround(byte: number): void {
    if (byte === ESC) {
      this.state = "escape";
      return;
    }
    // Single-byte and ASCII: already at a boundary.
    if (byte < 0x80) return;

    const owed = utf8ContinuationBytes(byte);
    if (owed === 0) return; // A stray continuation byte; nothing to wait for.
    this.state = "utf8";
    this.pending = owed;
  }
}

/** How many continuation bytes this lead byte promises, or 0 if it is not one. */
function utf8ContinuationBytes(lead: number): number {
  if ((lead & 0xe0) === 0xc0) return 1;
  if ((lead & 0xf0) === 0xe0) return 2;
  if ((lead & 0xf8) === 0xf0) return 3;
  return 0;
}
