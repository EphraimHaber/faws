import type { S3OpenAs } from "@faws/contracts";

/** Storage classes whose bytes are not readable without a restore first. */
const ARCHIVED = new Set(["GLACIER", "DEEP_ARCHIVE", "GLACIER_IR"]);

/** `GLACIER_IR` reads immediately despite being an archive tier. */
const ARCHIVED_BUT_INSTANT = new Set(["GLACIER_IR"]);

const BY_EXTENSION: Readonly<Record<string, S3OpenAs>> = {
  json: "json",
  jsonl: "jsonl",
  ndjson: "jsonl",
  csv: "csv",
  tsv: "csv",
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  bmp: "image",
  ico: "image",
  mp3: "audio",
  wav: "audio",
  flac: "audio",
  ogg: "audio",
  m4a: "audio",
  aac: "audio",
  mp4: "video",
  webm: "video",
  mov: "video",
  mkv: "video",
  txt: "text",
  log: "text",
  md: "text",
  yaml: "text",
  yml: "text",
  toml: "text",
  ini: "text",
  xml: "text",
  html: "text",
  css: "text",
  js: "text",
  ts: "text",
  tsx: "text",
  jsx: "text",
  py: "text",
  go: "text",
  rs: "text",
  java: "text",
  rb: "text",
  sh: "text",
  sql: "text",
  tf: "text",
  env: "text",
  conf: "text",
};

/** Content types that say nothing, so the extension gets the next word. */
const VAGUE_TYPES = new Set([
  "application/octet-stream",
  "binary/octet-stream",
  "application/x-www-form-urlencoded",
  "",
]);

/**
 * How to open an object, from its content type first and its key second.
 *
 * The stored type wins when it says anything at all, because it is the only
 * part of this an uploader states deliberately. Extensions decide the rest:
 * most objects written by tooling arrive as `application/octet-stream`
 * regardless of what they hold.
 */
export function classifyOpenAs(key: string, contentType: string | null): S3OpenAs {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

  // An SVG is a document that can carry script, so it is never rendered as a
  // picture here; its source is shown instead.
  if (type === "image/svg+xml" || /\.svgz?$/i.test(key)) return "text";

  if (!VAGUE_TYPES.has(type)) {
    if (type.startsWith("image/")) return "image";
    if (type.startsWith("audio/")) return "audio";
    if (type.startsWith("video/")) return "video";
    if (type === "application/pdf") return "pdf";
    if (type === "application/json" || type.endsWith("+json")) return "json";
    if (type === "application/x-ndjson" || type === "application/jsonl") return "jsonl";
    if (type === "text/csv" || type === "text/tab-separated-values") return "csv";
    if (type.startsWith("text/")) return "text";
    if (type === "application/xml" || type.endsWith("+xml")) return "text";
    if (type === "application/javascript" || type === "application/x-yaml") return "text";
  }

  return byExtension(key);
}

function byExtension(key: string): S3OpenAs {
  const name = key.slice(key.lastIndexOf("/") + 1);
  // A compressed object is named for what it holds, so the extension that
  // decides the viewer is the one before `.gz`.
  const stripped = name.replace(/\.(gz|gzip)$/i, "");
  const dot = stripped.lastIndexOf(".");
  if (dot === -1) return "binary";
  const extension = stripped.slice(dot + 1).toLowerCase();
  return BY_EXTENSION[extension] ?? "binary";
}

/** Whether the bytes can be fetched now, or need a restore first. */
export function isReadable(storageClass: string, restore: string | null): boolean {
  if (!ARCHIVED.has(storageClass) || ARCHIVED_BUT_INSTANT.has(storageClass)) return true;
  // The header reads `ongoing-request="false"` once a copy is available.
  return restore !== null && /ongoing-request="false"/.test(restore);
}
