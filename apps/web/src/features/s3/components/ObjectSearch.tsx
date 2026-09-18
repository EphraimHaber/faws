import { type S3ObjectSummary, type S3ScanProgress, toS3Scope } from "@faws/contracts";
import { byteSize, requiresDeep } from "@faws/shared";
import { Download, Search, Square, Telescope } from "lucide-react";
import * as React from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Kbd } from "~/components/ui/kbd";
import { Spinner } from "~/components/ui/spinner";
import { useS3Scope } from "~/contexts/ScopeContext";
import { startScan, type RunningScan } from "~/lib/s3-scan";
import { cn } from "~/lib/utils";

/** Ceilings a single scan will not walk past, so one query cannot run for ever. */
const MAX_OBJECTS = 200_000;
const MAX_SECONDS = 120;

export interface ScanState {
  readonly running: boolean;
  readonly hits: ReadonlyArray<S3ObjectSummary>;
  readonly progress: S3ScanProgress | null;
  readonly error: string | null;
}

export const IDLE_SCAN: ScanState = { running: false, hits: [], progress: null, error: null };

/**
 * Recursive search across a prefix.
 *
 * Applying is explicit rather than debounced: a scan is a walk over every key
 * under the prefix, billed per thousand, and a keystroke-per-request search
 * box is a surprising thing to find on a bill.
 */
export function ObjectSearch({
  bucket,
  prefix,
  state,
  onState,
}: {
  bucket: string;
  prefix: string;
  state: ScanState;
  onState: (next: ScanState) => void;
}) {
  const scope = useS3Scope();
  const [query, setQuery] = React.useState("");
  const running = React.useRef<RunningScan | null>(null);

  // A scan outlives the render that started it, so leaving the page has to
  // stop it rather than simply stop listening to it.
  React.useEffect(() => {
    return () => running.current?.cancel();
  }, []);

  const stop = React.useCallback(() => {
    running.current?.cancel();
    running.current = null;
    onState({ ...state, running: false });
  }, [onState, state]);

  const start = React.useCallback(() => {
    const pattern = query.trim();
    if (pattern.length === 0) return;

    running.current?.cancel();
    let hits: S3ObjectSummary[] = [];
    onState({ running: true, hits, progress: null, error: null });

    running.current = startScan(
      {
        scanId: crypto.randomUUID(),
        ...toS3Scope(scope),
        bucket,
        prefix,
        pattern,
        maxObjects: MAX_OBJECTS,
        maxSeconds: MAX_SECONDS,
      },
      {
        onChunk: (objects) => {
          hits = [...hits, ...objects];
          onState({ running: true, hits, progress: null, error: null });
        },
        onProgress: (progress) => onState({ running: true, hits, progress, error: null }),
        onDone: (progress) => {
          running.current = null;
          onState({ running: false, hits, progress, error: null });
        },
        onError: (message) => {
          running.current = null;
          onState({ running: false, hits, progress: null, error: message });
        },
      },
    );
  }, [query, scope, bucket, prefix, onState]);

  const exportKeys = React.useCallback(() => {
    const blob = new Blob([state.hits.map((hit) => hit.key).join("\n")], {
      type: "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `s3-keys-${bucket}-${Date.now()}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [state.hits, bucket]);

  const deep = requiresDeep(query);

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <Search className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.7} />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") start();
          }}
          placeholder="Search every key under this prefix, e.g. **/*.json"
          aria-label="Search keys"
          className="max-w-lg font-mono"
        />
        {state.running ? (
          <Button size="sm" variant="danger" onClick={stop}>
            <Square className="size-3" /> Stop
          </Button>
        ) : (
          <Button size="sm" onClick={start} disabled={query.trim().length === 0}>
            Search <Kbd>↵</Kbd>
          </Button>
        )}
        {state.hits.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={exportKeys}>
            <Download className="size-3" /> Export {state.hits.length} keys
          </Button>
        ) : null}
      </div>

      <div className="flex items-center gap-3 font-mono text-[10.5px] text-muted-foreground">
        {state.running ? <Spinner className="size-3" /> : null}
        {deep ? (
          <span className="flex items-center gap-1 text-info">
            <Telescope className="size-3" /> crosses folders
          </span>
        ) : (
          <span>* stops at a slash, ** crosses one</span>
        )}
        {state.progress ? (
          <span className={cn(state.progress.truncated && "text-warning")}>
            {state.progress.matched} of {state.progress.scanned} keys ·{" "}
            {byteSize(state.progress.bytes)}
            {state.progress.truncated ? " · stopped at the limit" : ""}
          </span>
        ) : null}
        {state.error ? <span className="text-danger">{state.error}</span> : null}
      </div>
    </div>
  );
}
