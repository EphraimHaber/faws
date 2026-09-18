import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Film, Trash2 } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { CopyButton } from "~/components/ui/copy-button";
import { EmptyState } from "~/components/ui/empty";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { fullTimestamp } from "~/lib/format";
import { trpc } from "~/lib/trpc";
import { useSessions } from "~/stores/sessions";

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Session recordings.
 *
 * Here rather than in the dock, because this is the "what did I run last
 * Tuesday" view rather than part of running a shell. The path is copyable
 * because the thing people do with a cast file is hand it to `asciinema play`
 * or to someone else - playback in the app would be a second terminal renderer
 * for a job the format already has a tool for.
 */
export function RecordingsPanel() {
  const recordings = useQuery(trpc.exec.recordings.queryOptions());
  const queryClient = useQueryClient();
  const recordByDefault = useSessions((state) => state.recordByDefault);
  const setRecordByDefault = useSessions((state) => state.setRecordByDefault);

  const remove = useMutation({
    ...trpc.exec.deleteRecording.mutationOptions(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.exec.recordings.queryKey() }),
  });

  const rows = recordings.data ?? [];

  return (
    <Panel className="shrink-0">
      <PanelHeader>
        <PanelTitle>Session recordings</PanelTitle>
        <span className="font-mono text-[11px] text-muted-foreground tabular">{rows.length}</span>
        <label className="ml-auto flex items-center gap-1.5 text-[12px]">
          <input
            type="checkbox"
            checked={recordByDefault}
            onChange={(event) => setRecordByDefault(event.target.checked)}
          />
          Record new sessions
        </label>
      </PanelHeader>

      {rows.length === 0 ? (
        <EmptyState
          icon={Film}
          title="No recordings yet"
          hint="Every session is written as an asciicast, replayable with `asciinema play`"
        />
      ) : (
        <div className="max-h-80 overflow-auto">
          {rows.map((row) => (
            <div
              key={row.path}
              className="flex items-center gap-2.5 border-b border-border/50 px-3.5 py-2 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px]">{row.target ?? row.name}</p>
                <p className="truncate font-mono text-[10.5px] text-muted-foreground">
                  {fullTimestamp(row.modifiedAt)}
                  {row.region ? ` · ${row.profile ?? "default"} / ${row.region}` : ""}
                </p>
              </div>
              {row.kind ? <Badge tone="neutral">{row.kind}</Badge> : null}
              <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground tabular">
                {sizeLabel(row.bytes)}
              </span>
              <CopyButton value={row.path} />
              <Button
                variant="ghost"
                title="Delete this recording"
                aria-label={`Delete ${row.name}`}
                onClick={() => remove.mutate({ path: row.path })}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
