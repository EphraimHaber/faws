import { useQuery } from "@tanstack/react-query";
import { useHotkeys } from "@tanstack/react-hotkeys";
import { Check, ChevronsUpDown, RefreshCw } from "lucide-react";
import * as React from "react";

import { StatusDot, type StatusTone } from "~/components/ui/status-dot";
import { useAwsScope, useScope } from "~/contexts/ScopeContext";
import { describe } from "~/lib/hotkeys";
import { trpc } from "~/lib/trpc";
import { useOverlay, useOverlaysOpen } from "~/stores/overlays";
import { cn } from "~/lib/utils";

/**
 * Profile + account identity, resolved live via sts:GetCallerIdentity.
 *
 * The dot is the whole point: green means these credentials just worked,
 * amber means we're still checking, red means the next thing you click will
 * fail. Ctrl+P opens the same list e1s binds.
 */
export function AccountChip() {
  const scope = useAwsScope();
  const { profile, setProfile } = useScope();
  const [open, setOpen] = React.useState(false);
  const overlayOpen = useOverlaysOpen();
  const { isTop } = useOverlay("profile-picker", open);

  const profiles = useQuery({ ...trpc.aws.profiles.queryOptions(), staleTime: 60_000 });
  const whoami = useQuery({
    ...trpc.aws.whoami.queryOptions(scope),
    retry: false,
    staleTime: 60_000,
  });

  useHotkeys(
    [
      {
        hotkey: "Control+P",
        callback: () => setOpen((prev) => !prev),
        // Not gated on overlays: this is how you leave the picker again.
        options: { enabled: !overlayOpen || open, meta: describe("Context", "Switch AWS profile") },
      },
      {
        hotkey: "Escape",
        callback: () => setOpen(false),
        options: { enabled: isTop, conflictBehavior: "allow" },
      },
    ],
    { preventDefault: true },
  );

  const tone: StatusTone = whoami.isFetching
    ? "warning"
    : whoami.isError
      ? "danger"
      : whoami.data?.accountId
        ? "success"
        : "neutral";

  return (
    <div className="relative flex items-center gap-2">
      <StatusDot tone={tone} pulse={whoami.isFetching} />
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded px-1 py-0.5 leading-none transition-colors hover:bg-accent"
        title="Switch AWS profile (Ctrl+P)"
      >
        <span className="font-mono text-[11.5px] text-foreground">{profile}</span>
        {whoami.data?.accountId ? (
          <span className="font-mono text-[10.5px] text-muted-foreground tabular">
            {whoami.data.accountId}
          </span>
        ) : null}
        <ChevronsUpDown className="size-3 text-muted-foreground/60" strokeWidth={1.9} />
      </button>
      <button
        type="button"
        onClick={() => void whoami.refetch()}
        aria-label="Re-check credentials"
        title="Re-check credentials"
        className="grid size-6 cursor-pointer place-items-center rounded text-muted-foreground/70 transition-colors hover:text-foreground"
      >
        <RefreshCw
          className={cn("size-3", whoami.isFetching && "animate-spin")}
          strokeWidth={1.9}
        />
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close profile list"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute top-8 right-0 z-50 max-h-80 w-72 overflow-auto rounded-lg border border-border bg-popover p-1 shadow-xl">
            <p className="px-2 py-1.5 font-mono text-[9.5px] tracking-[0.22em] text-muted-foreground uppercase">
              AWS profiles
            </p>
            {(profiles.data ?? []).map((entry) => (
              <button
                key={entry.name}
                type="button"
                onClick={() => {
                  setProfile(entry.name);
                  setOpen(false);
                }}
                className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-accent"
              >
                <Check
                  className={cn(
                    "size-3 shrink-0",
                    entry.name === profile ? "text-primary" : "opacity-0",
                  )}
                />
                <span className="flex-1 truncate font-mono text-[12px]">{entry.name}</span>
                {entry.sso ? (
                  <span className="font-mono text-[9.5px] text-muted-foreground">SSO</span>
                ) : null}
                {entry.region ? (
                  <span className="font-mono text-[10px] text-muted-foreground/70">
                    {entry.region}
                  </span>
                ) : null}
              </button>
            ))}
            {profiles.data?.length === 0 ? (
              <p className="px-2 py-3 text-center text-[12px] text-muted-foreground">
                No profiles in ~/.aws
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
