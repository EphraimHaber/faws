import * as React from "react";

import { cn } from "~/lib/utils";

/** Rows past this are not laid out; the pane is a look, not a spreadsheet. */
const MAX_ROWS = 2000;

/**
 * Delimited or line delimited records as a grid.
 *
 * Separate columns are the whole reason to render a CSV as anything other than
 * text: a column of numbers that do not line up is a column nobody can read.
 */
export function TableViewer({ text, kind }: { text: string; kind: "csv" | "jsonl" }) {
  const parsed = React.useMemo(
    () => (kind === "csv" ? parseDelimited(text) : parseJsonLines(text)),
    [text, kind],
  );

  if (parsed.rows.length === 0) {
    return (
      <p className="p-4 text-[12px] text-muted-foreground">Nothing that parses as rows here.</p>
    );
  }

  const shown = parsed.rows.slice(0, MAX_ROWS);

  /* A grid of positional records has no identity but position: two rows may be
     byte for byte identical, and the row number is what the reader is looking
     at. The index is the key here rather than a stand in for one. */

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border">
              <th className="h-7 w-12 px-2 text-right font-mono text-[10px] font-normal text-muted-foreground/60">
                #
              </th>
              {parsed.headers.map((header, index) => (
                <th
                  // oxlint-disable-next-line react/no-array-index-key
                  key={`${header}:${index}`}
                  className="h-7 px-2 text-left font-mono text-[10px] font-normal tracking-[0.14em] whitespace-nowrap text-muted-foreground uppercase"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, rowIndex) => (
              // oxlint-disable-next-line react/no-array-index-key
              <tr key={rowIndex} className="border-b border-border/45 hover:bg-accent/50">
                <td className="px-2 text-right font-mono text-[10.5px] text-muted-foreground/50 tabular">
                  {rowIndex + 1}
                </td>
                {parsed.headers.map((_, cellIndex) => {
                  const value = row[cellIndex] ?? "";
                  return (
                    <td
                      // oxlint-disable-next-line react/no-array-index-key
                      key={cellIndex}
                      title={value}
                      className={cn(
                        "max-w-[28rem] truncate px-2 font-mono text-[11.5px]",
                        isNumeric(value) && "text-right tabular",
                      )}
                    >
                      {value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="shrink-0 border-t border-border px-3 py-1 font-mono text-[10px] text-muted-foreground">
        {shown.length < parsed.rows.length
          ? `${shown.length} of ${parsed.rows.length} rows`
          : `${parsed.rows.length} rows`}
        {parsed.truncatedLine ? " · last line incomplete" : ""}
      </p>
    </div>
  );
}

interface Parsed {
  readonly headers: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
  /** True when the text ends mid record, as a fetched slice usually does. */
  readonly truncatedLine: boolean;
}

function isNumeric(value: string): boolean {
  return value.length > 0 && value.length < 24 && !Number.isNaN(Number(value));
}

/**
 * Comma or tab separated records, with quoted fields respected.
 *
 * The delimiter is guessed from the first line: a file named `.csv` is often
 * tab separated, and the guess is right more often than the extension.
 */
export function parseDelimited(text: string): Parsed {
  const lines = text.split(/\r?\n/);
  const endsClean = text.endsWith("\n") || text.endsWith("\r\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) return { headers: [], rows: [], truncatedLine: false };

  const first = lines[0] ?? "";
  const delimiter =
    (first.match(/\t/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? "\t" : ",";

  const records = lines.map((line) => splitRecord(line, delimiter));
  const headers = records[0] ?? [];
  const widest = records.reduce((max, record) => Math.max(max, record.length), headers.length);

  return {
    headers: Array.from({ length: widest }, (_, index) => headers[index] ?? `col ${index + 1}`),
    rows: records.slice(1),
    truncatedLine: !endsClean && records.length > 1,
  };
}

function splitRecord(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === delimiter) {
      out.push(field);
      field = "";
    } else field += char;
  }
  out.push(field);
  return out;
}

/**
 * One JSON document per line, flattened to the union of their keys.
 *
 * Records in a stream rarely all carry the same fields, so the columns are
 * collected across the file rather than taken from the first line.
 */
export function parseJsonLines(text: string): Parsed {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const endsClean = text.endsWith("\n") || text.endsWith("\r\n");

  const parsed: Array<Record<string, unknown>> = [];
  let truncatedLine = false;

  for (const [index, line] of lines.entries()) {
    try {
      const value: unknown = JSON.parse(line);
      parsed.push(
        value !== null && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : { value },
      );
    } catch {
      // A slice of a larger object ends mid line; anything else is a record
      // that does not parse, and neither is worth failing the whole view for.
      if (index === lines.length - 1 && !endsClean) truncatedLine = true;
    }
  }

  const headers: string[] = [];
  for (const record of parsed) {
    for (const key of Object.keys(record)) {
      if (!headers.includes(key)) headers.push(key);
    }
  }

  return {
    headers,
    rows: parsed.map((record) => headers.map((key) => cellText(record[key]))),
    truncatedLine,
  };
}

function cellText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
