import { Trash2 } from "lucide-react";
import * as React from "react";

import { FilterInput } from "~/components/toolbar";
import { Button } from "~/components/ui/button";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { clockTime } from "~/lib/format";
import { useLogStore } from "~/lib/log-store";
import { cn } from "~/lib/utils";
import { useFilterSearch } from "~/hooks/useSearchState";

const LEVEL_CLASS: Record<string, string> = {
  trace: "text-muted-foreground/60",
  debug: "text-muted-foreground",
  info: "text-info",
  warn: "text-warning",
  error: "text-danger",
  fatal: "text-danger",
};

/**
 * Live tail of faws's own server process — every AWS call this app makes.
 *
 * Deliberately not your containers' output: that lives on the Logs tab of a
 * service or a task. This is where you look when the app itself misbehaves.
 */
export function LogsPage() {
  const lines = useLogStore((state) => state.lines);
  const clear = useLogStore((state) => state.clear);
  const [filter, setFilter] = useFilterSearch();
  const [follow, setFollow] = React.useState(true);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  const visible = React.useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return lines;
    return lines.filter(
      (line) =>
        line.msg.toLowerCase().includes(query) ||
        line.name.toLowerCase().includes(query) ||
        line.level.includes(query),
    );
  }, [lines, filter]);

  React.useEffect(() => {
    if (follow) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [visible.length, follow]);

  return (
    <Panel className="flex-1">
      <PanelHeader>
        <PanelTitle>Diagnostics</PanelTitle>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          faws server · not your container logs
        </span>
        <span className="font-mono text-[11px] text-muted-foreground tabular">
          {visible.length}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <FilterInput value={filter} onChange={setFilter} placeholder="Filter log lines…" />
          <Button
            variant={follow ? "default" : "outline"}
            onClick={() => setFollow((prev) => !prev)}
            title="Keep the newest line in view"
          >
            Follow
          </Button>
          <Button variant="ghost" size="icon" onClick={clear} aria-label="Clear log buffer">
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </PanelHeader>

      <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11.5px] leading-relaxed">
        {visible.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">
            Nothing yet. Server activity streams here as it happens.
          </p>
        ) : (
          visible.map((line) => (
            <div key={line.id} className="flex gap-2.5 whitespace-pre-wrap">
              <span className="shrink-0 text-muted-foreground/60 tabular">
                {clockTime(line.time)}
              </span>
              <span className={cn("w-10 shrink-0 uppercase", LEVEL_CLASS[line.level])}>
                {line.level}
              </span>
              <span className="w-28 shrink-0 truncate text-muted-foreground">{line.name}</span>
              <span className="min-w-0 flex-1">{line.msg}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </Panel>
  );
}
