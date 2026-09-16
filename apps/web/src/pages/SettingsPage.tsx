import { relativeTime } from "@faws/shared";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { KeyValue, KeyValueGrid } from "~/components/kv";
import { Badge } from "~/components/ui/badge";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { REFRESH_CHOICES, useAwsScope, useScope } from "~/contexts/ScopeContext";
import { useTheme } from "~/contexts/ThemeContext";
import { trpc } from "~/lib/trpc";
import { type SilenceEntry, useSilenced } from "~/stores/silenced";
import { cn } from "~/lib/utils";

export function SettingsPage() {
  const scope = useAwsScope();
  const { refreshSeconds, setRefreshSeconds } = useScope();
  const { theme, toggle } = useTheme();

  const whoami = useQuery({ ...trpc.aws.whoami.queryOptions(scope), retry: false });
  const readOnly = useQuery(trpc.ecsActions.readOnly.queryOptions());

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <Panel className="shrink-0">
        <PanelHeader>
          <PanelTitle>Session</PanelTitle>
        </PanelHeader>
        <KeyValueGrid className="px-3.5 py-3">
          <KeyValue label="Profile">{scope.profile}</KeyValue>
          <KeyValue label="Region">{scope.region}</KeyValue>
          <KeyValue label="Account">{whoami.data?.accountId ?? "-"}</KeyValue>
          <KeyValue label="Identity">{whoami.data?.arn ?? "-"}</KeyValue>
          <KeyValue label="Mode">
            <Badge tone={readOnly.data?.readOnly ? "warning" : "success"}>
              {readOnly.data?.readOnly ? "read-only" : "read-write"}
            </Badge>
          </KeyValue>
        </KeyValueGrid>
      </Panel>

      <SilencedPanel />

      <Panel className="shrink-0">
        <PanelHeader>
          <PanelTitle>Preferences</PanelTitle>
        </PanelHeader>
        <div className="flex flex-col gap-4 px-3.5 py-3.5">
          <Setting
            title="Auto-refresh"
            hint="How often every open list re-queries AWS. Manual disables the timer."
          >
            <div className="flex items-center gap-1">
              {REFRESH_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => setRefreshSeconds(choice)}
                  className={cn(
                    "cursor-pointer rounded px-2 py-1 font-mono text-[11.5px] transition-colors",
                    choice === refreshSeconds
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {choice === -1 ? "manual" : `${choice}s`}
                </button>
              ))}
            </div>
          </Setting>

          <Setting title="Appearance" hint="Dark is the default; both themes are first-class.">
            <button
              type="button"
              onClick={toggle}
              className="cursor-pointer rounded border border-border px-2.5 py-1 text-[12px] transition-colors hover:bg-accent"
            >
              {theme === "dark" ? "Dark" : "Light"}
            </button>
          </Setting>
        </div>
      </Panel>
    </div>
  );
}

/**
 * Everything the operator has chosen not to see, in one place.
 *
 * Silencing is only safe if it is reversible and visible; a warning that can
 * be hidden with no record of hiding it is a way to lose an incident.
 */
function SilencedPanel() {
  const dismissed = useSilenced((state) => state.dismissed);
  const muted = useSilenced((state) => state.muted);
  const restore = useSilenced((state) => state.restore);
  const restoreAll = useSilenced((state) => state.restoreAll);

  const entries: Array<{ entry: SilenceEntry; kind: "muted" | "dismissed" }> = [
    ...Object.values(muted).map((entry) => ({ entry, kind: "muted" as const })),
    ...Object.values(dismissed).map((entry) => ({ entry, kind: "dismissed" as const })),
  ].toSorted((a, b) => b.entry.at.localeCompare(a.entry.at));

  return (
    <Panel className="shrink-0">
      <PanelHeader>
        <PanelTitle>Silenced warnings</PanelTitle>
        <span className="font-mono text-[11px] text-muted-foreground tabular">
          {entries.length}
        </span>
        {entries.length > 0 ? (
          <button
            type="button"
            onClick={restoreAll}
            className="ml-auto cursor-pointer font-mono text-[10.5px] text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground"
          >
            restore all
          </button>
        ) : null}
      </PanelHeader>

      {entries.length === 0 ? (
        <p className="px-3.5 py-4 text-[12.5px] text-muted-foreground">
          Nothing is silenced. Dismiss a failure from the overview to hide one incident, or mute a
          service to hide every warning from something another team owns.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {entries.map(({ entry, kind }) => (
            <li key={`${kind}:${entry.arn}`} className="flex items-center gap-3 px-3.5 py-2">
              <Badge tone={kind === "muted" ? "warning" : "neutral"}>{kind}</Badge>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px]">{entry.label}</span>
                <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                  {entry.context}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground tabular">
                {relativeTime(entry.at)}
              </span>
              <button
                type="button"
                onClick={() => restore(entry.arn)}
                className="shrink-0 cursor-pointer rounded border border-border px-2 py-0.5 text-[11.5px] transition-colors hover:bg-accent"
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Setting({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-6">
      <div className="min-w-0 flex-1">
        <p className="text-[13px]">{title}</p>
        <p className="text-[12px] text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}
