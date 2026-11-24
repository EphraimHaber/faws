import type { UpdateStatus } from "@faws/contracts";
import { Link } from "@tanstack/react-router";

import { useClock } from "~/hooks/useClock";
import { formatAge } from "~/components/refresh";
import { Button } from "~/components/ui/button";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { Switch } from "~/components/ui/switch";
import { textActionClass } from "~/components/ui/text-action";
import { cn } from "~/lib/utils";
import { updateSettings, useSettings } from "~/stores/settings";
import { updateActions, useUpdates } from "~/stores/updates";

/** Which version this is, whether a newer one exists, and how to get it. */
export function UpdatesPanel() {
  const status = useUpdates((state) => state.status);
  const prefs = useSettings((state) => state.settings.updates);
  const supported = status.state !== "unsupported";

  return (
    <Panel className="shrink-0">
      <PanelHeader>
        <PanelTitle>About and updates</PanelTitle>
        <Link to="/whats-new" className={cn(textActionClass, "ml-auto")}>
          what's new
        </Link>
      </PanelHeader>
      <div className="flex flex-col gap-3 px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[13px]">
            faws <span className="font-mono">{status.currentVersion}</span>
          </p>
          <StatusLine status={status} />
          <span className="ml-auto flex items-center gap-2">
            <UpdateAction status={status} />
          </span>
        </div>

        {supported ? (
          <>
            <label className="flex items-center gap-3 text-[12.5px]">
              <span className="min-w-0 flex-1">
                Check for updates automatically
                <span className="block text-[12px] text-muted-foreground">
                  Off, the app never contacts GitHub unless you press Check.
                </span>
              </span>
              <Switch
                aria-label="Check for updates automatically"
                checked={prefs.autoCheck}
                onCheckedChange={(autoCheck) => updateSettings({ updates: { autoCheck } })}
              />
            </label>
            <label className="flex items-center gap-3 text-[12.5px]">
              <span className="min-w-0 flex-1">
                Release channel
                <span className="block text-[12px] text-muted-foreground">
                  Beta also offers pre-releases.
                </span>
              </span>
              <select
                value={prefs.channel}
                onChange={(event) =>
                  updateSettings({
                    updates: { channel: event.target.value === "beta" ? "beta" : "stable" },
                  })
                }
                className="cursor-pointer rounded border border-border bg-background px-2 py-1 text-[12px]"
              >
                <option value="stable">Stable</option>
                <option value="beta">Beta</option>
              </select>
            </label>
          </>
        ) : null}
      </div>
    </Panel>
  );
}

function StatusLine({ status }: { status: UpdateStatus }) {
  const now = useClock();
  const checked = status.checkedAt
    ? ` · checked ${formatAge(Date.parse(status.checkedAt), now)}`
    : "";
  const text: Record<UpdateStatus["state"], string> = {
    idle: "Not checked yet",
    checking: "Checking…",
    "up-to-date": `Up to date${checked}`,
    available: `Version ${status.version} is available${checked}`,
    downloading: `Downloading ${status.version}… ${status.progress ?? 0}%`,
    ready: `Version ${status.version} is ready; restart to install`,
    error: `Could not check: ${status.error ?? "unknown error"}`,
    unsupported: status.reason ?? "This build does not update itself",
  };
  return (
    <p
      className={cn(
        "font-mono text-[11px]",
        status.state === "error"
          ? "text-danger"
          : status.state === "available" || status.state === "ready"
            ? "text-primary"
            : "text-muted-foreground",
      )}
    >
      {text[status.state]}
    </p>
  );
}

/** The one thing to do next, whatever the state is. */
export function UpdateAction({ status, size = "sm" }: { status: UpdateStatus; size?: "sm" }) {
  switch (status.state) {
    case "unsupported":
      return null;
    case "available":
      return (
        <Button size={size} variant="default" onClick={updateActions.download}>
          {status.canInstall ? `Download ${status.version}` : `Get ${status.version}`}
        </Button>
      );
    case "ready":
      return (
        <Button size={size} variant="default" onClick={updateActions.install}>
          Restart to update
        </Button>
      );
    case "downloading":
    case "checking":
      return (
        <Button size={size} disabled>
          {status.state === "checking" ? "Checking…" : "Downloading…"}
        </Button>
      );
    default:
      return (
        <Button size={size} variant="outline" onClick={updateActions.check}>
          Check now
        </Button>
      );
  }
}
