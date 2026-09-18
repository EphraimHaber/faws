import { diffLines, diffStat, type DiffLine } from "@faws/shared";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { Dialog } from "~/features/s3/components/Dialog";
import { Button } from "~/components/ui/button";
import { ErrorState } from "~/components/ui/error-state";
import { Spinner } from "~/components/ui/spinner";
import { useAwsScope } from "~/contexts/ScopeContext";
import { fetchRange } from "~/lib/s3-bytes";
import { cn } from "~/lib/utils";

/** How much of each side is read; a diff is a reading tool, not a merge. */
const SIDE_BYTES = 256 * 1024;

export interface DiffSide {
  readonly key: string;
  readonly versionId: string;
  readonly label: string;
}

/**
 * Two versions of an object, side by side as one column.
 *
 * Only the leading part of each side is read: the question a diff answers here
 * is "what changed between these", and an object large enough to exceed that
 * is one where the answer needs a real tool rather than a pane.
 */
export function ObjectDiff({
  bucket,
  left,
  right,
  onClose,
}: {
  bucket: string;
  left: DiffSide;
  right: DiffSide;
  onClose: () => void;
}) {
  const scope = useAwsScope();

  const sides = useQuery({
    queryKey: [
      "s3:diff",
      scope.profile,
      scope.region,
      bucket,
      left.key,
      left.versionId,
      right.key,
      right.versionId,
    ],
    queryFn: async ({ signal }) => {
      const [a, b] = await Promise.all([
        fetchRange(scope, { bucket, key: left.key, versionId: left.versionId }, 0, SIDE_BYTES, {
          signal,
        }),
        fetchRange(scope, { bucket, key: right.key, versionId: right.versionId }, 0, SIDE_BYTES, {
          signal,
        }),
      ]);
      const decoder = new TextDecoder();
      return { before: decoder.decode(a.bytes), after: decoder.decode(b.bytes) };
    },
    staleTime: 5 * 60_000,
  });

  const computed = React.useMemo(() => {
    if (!sides.data) return null;
    try {
      return { ok: true as const, lines: diffLines(sides.data.before, sides.data.after) };
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : String(err) };
    }
  }, [sides.data]);

  return (
    <Dialog id="s3-diff" title="Compare versions" onClose={onClose}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
          <span className="text-danger">− {left.label}</span>
          <span className="text-success">+ {right.label}</span>
          {computed?.ok ? <DiffSummary lines={computed.lines} /> : null}
        </div>

        {sides.isPending ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        ) : sides.isError ? (
          <ErrorState error={sides.error} onRetry={() => void sides.refetch()} />
        ) : computed?.ok === false ? (
          <p className="py-6 text-center text-[12px] text-warning">{computed.message}</p>
        ) : computed ? (
          <DiffBody lines={computed.lines} />
        ) : null}

        <div className="flex justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function DiffSummary({ lines }: { lines: ReadonlyArray<DiffLine> }) {
  const stat = diffStat(lines);
  if (stat.added === 0 && stat.removed === 0) {
    return <span className="text-muted-foreground">identical</span>;
  }
  return (
    <span className="tabular">
      <span className="text-success">+{stat.added}</span>{" "}
      <span className="text-danger">-{stat.removed}</span>
    </span>
  );
}

function DiffBody({ lines }: { lines: ReadonlyArray<DiffLine> }) {
  return (
    <div className="max-h-[28rem] overflow-auto rounded border border-border bg-background/40">
      <pre className="font-mono text-[11.5px] leading-[1.5]">
        {lines.map((line, index) => (
          <div
            // A diff row is positional: two identical lines are different rows.
            // oxlint-disable-next-line react/no-array-index-key
            key={index}
            className={cn(
              "flex gap-2 whitespace-pre px-2",
              line.kind === "added" && "bg-success/12",
              line.kind === "removed" && "bg-danger/12",
            )}
          >
            <span className="w-10 shrink-0 text-right text-muted-foreground/45 tabular">
              {line.left ?? ""}
            </span>
            <span className="w-10 shrink-0 text-right text-muted-foreground/45 tabular">
              {line.right ?? ""}
            </span>
            <span
              className={cn(
                "w-3 shrink-0",
                line.kind === "added" && "text-success",
                line.kind === "removed" && "text-danger",
              )}
            >
              {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
            </span>
            <span>{line.text}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
