import { Link } from "@tanstack/react-router";
import { Check, HardDrive, ShieldAlert } from "lucide-react";
import * as React from "react";

import { useScope } from "~/contexts/ScopeContext";
import { useS3Connections } from "~/features/s3/useS3Connections";
import { cn } from "~/lib/utils";

/**
 * Which storage system the S3 pages are looking at.
 *
 * It sits next to the listing rather than in the title bar because it moves
 * only these pages: profile and region still scope everything else, and a
 * connection that appeared to move the whole app would be a lie about what the
 * other services are reading.
 */
export function ConnectionPicker() {
  const { connectionId, setConnectionId } = useScope();
  const [open, setOpen] = React.useState(false);

  const saved = useS3Connections();
  const active = saved.find((entry) => entry.id === connectionId) ?? null;

  // An id whose endpoint has been deleted would otherwise leave every pane
  // failing against something that no longer exists.
  React.useEffect(() => {
    if (connectionId && !active) setConnectionId("");
  }, [connectionId, active, setConnectionId]);

  if (saved.length === 0) return null;

  const unverified = active !== null && !active.tls.verify;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        title="Which S3 endpoint these pages read"
        className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {unverified ? (
          <ShieldAlert className="size-3.5 text-warning" strokeWidth={1.8} />
        ) : (
          <HardDrive className="size-3.5 opacity-70" strokeWidth={1.8} />
        )}
        <span className="max-w-40 truncate text-[11.5px] text-foreground">
          {active ? active.name : "AWS"}
        </span>
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close endpoint list"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute top-8 left-0 z-50 w-72 rounded-lg border border-border bg-popover p-1 shadow-xl">
            <Choice
              label="AWS"
              detail="the profile and region in the title bar"
              selected={connectionId === ""}
              onSelect={() => {
                setConnectionId("");
                setOpen(false);
              }}
            />
            {saved.map((entry) => (
              <Choice
                key={entry.id}
                label={entry.name}
                detail={entry.endpoint}
                warn={!entry.tls.verify}
                selected={entry.id === connectionId}
                onSelect={() => {
                  setConnectionId(entry.id);
                  setOpen(false);
                }}
              />
            ))}

            {/* Picking an endpoint and editing one are the same thought a
                moment apart, and the list was the only place that named them
                at all - so this is where someone looks for the way in. */}
            <span aria-hidden className="mx-2 my-1 block h-px bg-border" />
            <Link
              to="/s3/connections"
              onClick={() => setOpen(false)}
              className="block rounded px-2 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Manage endpoints…
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Choice({
  label,
  detail,
  selected,
  warn = false,
  onSelect,
}: {
  label: string;
  detail: string;
  selected: boolean;
  warn?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-accent"
    >
      <Check className={cn("size-3 shrink-0", selected ? "text-primary" : "opacity-0")} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[12px]">{label}</span>
          {warn ? <ShieldAlert className="size-3 shrink-0 text-warning" strokeWidth={1.9} /> : null}
        </span>
        <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
          {detail}
        </span>
      </span>
    </button>
  );
}
