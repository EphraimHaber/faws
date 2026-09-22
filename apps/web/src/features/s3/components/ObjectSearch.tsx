import { type S3ObjectSummary, type S3ScanProgress, toS3Scope } from "@faws/contracts";
import { byteSize } from "@faws/shared";
import { Download, Square } from "lucide-react";
import * as React from "react";

import { SearchField } from "~/components/SearchField";
import { Button } from "~/components/ui/button";
import { Kbd } from "~/components/ui/kbd";
import { Spinner } from "~/components/ui/spinner";
import { useS3Scope } from "~/contexts/ScopeContext";
import { parseText, useSearchState } from "~/hooks/useSearchState";
import { startScan, type RunningScan } from "~/lib/s3-scan";
import { cn } from "~/lib/utils";

/** Ceilings a single scan will not walk past, so one query cannot run for ever. */
const MAX_OBJECTS = 200_000;
const MAX_SECONDS = 120;

/** How long the box holds still before the pattern lands in the URL. */
const PATTERN_DEBOUNCE_MS = 200;

export interface ScanState {
  readonly running: boolean;
  readonly hits: ReadonlyArray<S3ObjectSummary>;
  readonly progress: S3ScanProgress | null;
  readonly error: string | null;
  /** The pattern these hits came from, which is not what the box now says. */
  readonly pattern: string;
}

export const IDLE_SCAN: ScanState = {
  running: false,
  hits: [],
  progress: null,
  error: null,
  pattern: "",
};

/**
 * Recursive search across a prefix.
 *
 * Applying is explicit rather than debounced: a scan is a walk over every key
 * under the prefix, billed per thousand, and a keystroke-per-request search
 * box is a surprising thing to find on a bill.
 *
 * The pattern rides in the URL so a scan can be described to someone, but the
 * URL carries only the text, never the fact that it ran. A link opens with the
 * box filled in and the listing still on screen, waiting for Enter: a pasted
 * link that spends money on arrival is the one behaviour this must not have.
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
  const [query, setQuery] = useSearchState<string>({
    key: "scan",
    fallback: "",
    parse: parseText,
    debounceMs: PATTERN_DEBOUNCE_MS,
  });
  const running = React.useRef<RunningScan | null>(null);

  // A scan outlives the render that started it, so leaving the page has to
  // stop it rather than simply stop listening to it.
  React.useEffect(() => {
    return () => running.current?.cancel();
  }, []);

  // The listing can also be restored from the panel header, which puts the
  // state back to idle without coming through `stop`. A walk that is still
  // billing after the screen says it is over is the worst version of that, so
  // the socket follows the state rather than only the button.
  React.useEffect(() => {
    if (state.running) return;
    running.current?.cancel();
    running.current = null;
  }, [state.running]);

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
    onState({ running: true, hits, progress: null, error: null, pattern });

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
          onState({ running: true, hits, progress: null, error: null, pattern });
        },
        onProgress: (progress) => onState({ running: true, hits, progress, error: null, pattern }),
        onDone: (progress) => {
          running.current = null;
          onState({ running: false, hits, progress, error: null, pattern });
        },
        onError: (message) => {
          running.current = null;
          onState({ running: false, hits, progress: null, error: message, pattern });
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

  const pattern = query.trim();
  // What the box says and what produced the hits are separate on purpose: a
  // link arrives with the first and none of the second.
  const unapplied = pattern.length > 0 && pattern !== state.pattern;

  return (
    <div className="flex shrink-0 flex-col border-b border-border px-3 py-2">
      <SearchField
        surface="remote"
        value={query}
        onChange={setQuery}
        onSubmit={start}
        placeholder="Search every key under this prefix, e.g. **/*.json"
        inputClassName="w-full max-w-lg font-mono"
        actions={
          <>
            {state.running ? (
              <Button size="sm" variant="danger" onClick={stop}>
                <Square className="size-3" /> Stop
              </Button>
            ) : (
              <Button size="sm" onClick={start} disabled={pattern.length === 0}>
                Search <Kbd>↵</Kbd>
              </Button>
            )}
            {state.hits.length > 0 ? (
              <Button size="sm" variant="ghost" onClick={exportKeys}>
                <Download className="size-3" /> Export {state.hits.length} keys
              </Button>
            ) : null}
          </>
        }
        hint={
          <>
            {state.running ? <Spinner className="size-3" /> : null}
            {unapplied && !state.running ? (
              <span className="text-warning">
                Press <Kbd>↵</Kbd> to walk this prefix
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
          </>
        }
      />
    </div>
  );
}
