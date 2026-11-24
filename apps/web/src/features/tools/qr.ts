import QRCode from "qrcode";

/** Error correction levels, weakest (most data) to strongest. */
export const QR_LEVELS = ["L", "M", "Q", "H"] as const;
export type QrLevel = (typeof QR_LEVELS)[number];

export const QR_LEVEL_LABELS: Record<QrLevel, string> = {
  L: "L · 7%",
  M: "M · 15%",
  Q: "Q · 25%",
  H: "H · 30%",
};

export const MIN_QR_VERSION = 1;
export const MAX_QR_VERSION = 40;

/** Side length in modules of a symbol of the given version. */
export function modulesForVersion(version: number): number {
  return 17 + version * 4;
}

/**
 * Size presets, named for what reads them.
 *
 * Version 10 is about the densest a phone camera picks up reliably off a laptop
 * screen at arm's length; 25 needs a steady hand or a big screen; 40 is the
 * format's limit and wants a dedicated scanner or a screenshot.
 */
export const QR_PRESETS = [
  { id: "phone", label: "Phone friendly", version: 10, level: "M" },
  { id: "balanced", label: "Balanced", version: 20, level: "M" },
  { id: "dense", label: "Max density", version: 40, level: "L" },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  version: number;
  level: QrLevel;
}>;

export const DEFAULT_QR_PRESET = QR_PRESETS[0];

const encoder = new TextEncoder();

export function utf8Length(text: string): number {
  return encoder.encode(text).length;
}

function fits(bytes: number, version: number, level: QrLevel): boolean {
  try {
    QRCode.create([{ data: new Uint8Array(bytes), mode: "byte" }], {
      version,
      errorCorrectionLevel: level,
    });
    return true;
  } catch {
    return false;
  }
}

const capacityCache = new Map<string, number>();

/**
 * Most bytes one symbol of this version and level holds in byte mode.
 *
 * Found by asking the encoder rather than from a hand copied table, so it can
 * never disagree with what `encodeQr` will actually accept.
 */
export function byteCapacity(version: number, level: QrLevel): number {
  const key = `${version}:${level}`;
  const cached = capacityCache.get(key);
  if (cached !== undefined) return cached;

  let lo = 0;
  let hi = 3000;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid, version, level)) lo = mid;
    else hi = mid - 1;
  }
  capacityCache.set(key, lo);
  return lo;
}

export function partHeader(index: number, total: number): string {
  return `[${index + 1}/${total}] `;
}

/**
 * Splits text into pieces of at most `maxBytes` UTF-8 bytes each, header
 * included, never cutting a character in half.
 *
 * The header's width depends on how many parts there are, which depends on the
 * header's width, so the split is repeated until the count stops changing.
 */
export function splitText(text: string, maxBytes: number, withHeader: boolean): string[] {
  if (text.length === 0) return [];
  const chars = Array.from(text);

  let total = 1;
  for (let attempt = 0; attempt < 8; attempt++) {
    const headerBytes = withHeader ? utf8Length(partHeader(total - 1, total)) : 0;
    const room = maxBytes - headerBytes;
    if (room < 4) return [];

    const bodies: string[] = [];
    let current = "";
    let currentBytes = 0;
    for (const char of chars) {
      const size = utf8Length(char);
      if (currentBytes + size > room) {
        bodies.push(current);
        current = "";
        currentBytes = 0;
      }
      current += char;
      currentBytes += size;
    }
    bodies.push(current);

    if (!withHeader || bodies.length === 1) return bodies;
    if (bodies.length === total) {
      return bodies.map((body, index) => partHeader(index, total) + body);
    }
    total = bodies.length;
  }
  return [];
}

export interface QrPlan {
  readonly capacity: number;
  readonly totalBytes: number;
  readonly parts: ReadonlyArray<string>;
}

export function planQr(
  text: string,
  options: { version: number; level: QrLevel; header: boolean },
): QrPlan {
  const capacity = byteCapacity(options.version, options.level);
  const totalBytes = utf8Length(text);
  // a text that fits in one symbol never gets a header, so it scans as itself
  const parts =
    totalBytes <= capacity ? (text ? [text] : []) : splitText(text, capacity, options.header);
  return { capacity, totalBytes, parts };
}

export interface QrMatrix {
  readonly size: number;
  readonly version: number;
  readonly dark: (x: number, y: number) => boolean;
}

/**
 * Encodes one part in byte mode at the smallest version that holds it, up to
 * `maxVersion`.
 *
 * Byte mode always, rather than letting the encoder pick numeric or
 * alphanumeric segments, so the capacity shown is the capacity used.
 */
export function encodeQr(part: string, maxVersion: number, level: QrLevel): QrMatrix {
  const segments = [{ data: encoder.encode(part), mode: "byte" as const }];
  let version = MIN_QR_VERSION;
  const bytes = utf8Length(part);
  while (version < maxVersion && byteCapacity(version, level) < bytes) version++;
  const code = QRCode.create(segments, { version, errorCorrectionLevel: level });
  const { size, data } = code.modules;
  return { size, version: code.version, dark: (x, y) => data[y * size + x] === 1 };
}

/** One SVG path for every dark module, so a version 40 symbol is one DOM node. */
export function qrPath(matrix: QrMatrix): string {
  let d = "";
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (matrix.dark(x, y)) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  return d;
}
