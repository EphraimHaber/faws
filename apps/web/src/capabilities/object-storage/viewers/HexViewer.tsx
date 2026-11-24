import * as React from "react";

/** Bytes per line, which is what makes the columns line up by eye. */
const STRIDE = 16;

/**
 * Bytes as offsets, hex and printable characters.
 *
 * The last resort, and the only view that tells the truth about an object
 * nothing else can render: a magic number at the front usually says what a
 * mislabelled file really is.
 */
export function HexViewer({ bytes, startOffset = 0 }: { bytes: Uint8Array; startOffset?: number }) {
  const lines = React.useMemo(() => {
    const out: Array<{ offset: number; hex: string; text: string }> = [];
    for (let i = 0; i < bytes.length; i += STRIDE) {
      const slice = bytes.subarray(i, i + STRIDE);
      out.push({
        offset: startOffset + i,
        hex: [...slice]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join(" ")
          .padEnd(STRIDE * 3 - 1, " "),
        text: [...slice]
          .map((byte) => (byte >= 0x20 && byte < 0x7f ? String.fromCodePoint(byte) : "."))
          .join(""),
      });
    }
    return out;
  }, [bytes, startOffset]);

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <pre className="font-mono text-[11.5px] leading-[1.45]">
        {lines.map((line) => (
          <div key={line.offset} className="whitespace-pre">
            <span className="text-muted-foreground/55">
              {line.offset.toString(16).padStart(8, "0")}
            </span>
            <span className="text-muted-foreground"> {line.hex} </span>
            <span>{line.text}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
