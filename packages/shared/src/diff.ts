export type DiffKind = "same" | "added" | "removed";

export interface DiffLine {
  readonly kind: DiffKind;
  readonly text: string;
  /** Line number on the left, absent where the line was added. */
  readonly left: number | null;
  /** Line number on the right, absent where the line was removed. */
  readonly right: number | null;
}

/**
 * Lines past this and the comparison is abandoned rather than attempted.
 *
 * The table below is quadratic in the number of lines, which is fine for the
 * documents people actually compare and ruinous for a log file.
 */
export const MAX_DIFF_LINES = 4000;

export class DiffTooLargeError extends Error {
  constructor(lines: number) {
    super(`${lines} lines is too many to compare; ${MAX_DIFF_LINES} is the limit.`);
    this.name = "DiffTooLargeError";
  }
}

/**
 * A line by line comparison of two texts.
 *
 * The longest common subsequence, which is what makes an inserted block read
 * as an insertion rather than as every line after it having changed. Anything
 * cleverer - moved blocks, word level marks - is a different feature; this one
 * answers "what is different between these two versions".
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const left = splitLines(before);
  const right = splitLines(after);

  if (left.length + right.length > MAX_DIFF_LINES) {
    throw new DiffTooLargeError(left.length + right.length);
  }

  // table[i][j] is the length of the longest common subsequence of the
  // suffixes starting at i and j, built from the end so the walk below can
  // read forwards.
  const table: number[][] = Array.from({ length: left.length + 1 }, () =>
    Array.from({ length: right.length + 1 }, () => 0),
  );

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      const row = table[i];
      const nextRow = table[i + 1];
      if (!row || !nextRow) continue;
      row[j] =
        left[i] === right[j]
          ? (nextRow[j + 1] ?? 0) + 1
          : Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      out.push({ kind: "same", text: left[i] ?? "", left: i + 1, right: j + 1 });
      i += 1;
      j += 1;
      continue;
    }
    const down = table[i + 1]?.[j] ?? 0;
    const across = table[i]?.[j + 1] ?? 0;
    if (down >= across) {
      out.push({ kind: "removed", text: left[i] ?? "", left: i + 1, right: null });
      i += 1;
    } else {
      out.push({ kind: "added", text: right[j] ?? "", left: null, right: j + 1 });
      j += 1;
    }
  }

  while (i < left.length) {
    out.push({ kind: "removed", text: left[i] ?? "", left: i + 1, right: null });
    i += 1;
  }
  while (j < right.length) {
    out.push({ kind: "added", text: right[j] ?? "", left: null, right: j + 1 });
    j += 1;
  }

  return out;
}

/** How much changed, for a summary line above the diff. */
export function diffStat(lines: ReadonlyArray<DiffLine>): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "added") added += 1;
    else if (line.kind === "removed") removed += 1;
  }
  return { added, removed };
}

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  // A trailing newline ends the last line rather than starting an empty one.
  if (lines.at(-1) === "") lines.pop();
  return lines;
}
