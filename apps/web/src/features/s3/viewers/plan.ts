import type { S3ObjectHead, S3OpenAs } from "@faws/contracts";

/** Read whole below this; the whole object becomes a string in the page. */
export const WHOLE_LIMIT = 1024 * 1024;

/** Above this nothing is fetched without being asked for. */
export const REFUSE_LIMIT = 25 * 1024 * 1024;

/** How much of a large text object the head slice covers. */
export const HEAD_SLICE = 256 * 1024;

/** Kinds the browser fetches itself, at any size, without buffering. */
export type StreamKind = "image" | "audio" | "video" | "pdf";

/** Kinds that become a string in the page, so their size has to fit. */
export type TextKind = "text" | "json" | "jsonl" | "csv";

const STREAMED: ReadonlySet<S3OpenAs> = new Set<S3OpenAs>(["image", "audio", "video", "pdf"]);

export type ViewPlan =
  /** Fetch the whole object and render it. */
  | { kind: "whole"; openAs: TextKind }
  /** Fetch a leading slice and say so. */
  | { kind: "slice"; openAs: TextKind; bytes: number }
  /** Hand the URL to an element that fetches it itself. */
  | { kind: "stream"; openAs: StreamKind }
  /** Too large to open blind; offer the head, the hex or a download. */
  | { kind: "refuse"; reason: "size" }
  /** Archived, so the bytes are not there to be read yet. */
  | { kind: "refuse"; reason: "archived" }
  /** Nothing would render it, whatever its size. */
  | { kind: "binary" };

/**
 * What opening this object should actually do.
 *
 * The decision is taken from the head alone, before a byte is fetched: a
 * viewer that pulls first and measures afterwards is one click away from
 * pulling a multi gigabyte object into a tab.
 */
export function planFor(head: S3ObjectHead): ViewPlan {
  if (!head.readable) return { kind: "refuse", reason: "archived" };

  // Media and documents are handed to an element that ranges over them, so
  // their size never has to fit anywhere.
  if (STREAMED.has(head.openAs)) return { kind: "stream", openAs: head.openAs as StreamKind };

  if (head.openAs === "binary") return { kind: "binary" };

  const openAs = head.openAs as TextKind;
  if (head.size <= WHOLE_LIMIT) return { kind: "whole", openAs };
  if (head.size <= REFUSE_LIMIT) return { kind: "slice", openAs, bytes: HEAD_SLICE };
  return { kind: "refuse", reason: "size" };
}
