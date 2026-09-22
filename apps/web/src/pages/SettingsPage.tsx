import { relativeTime } from "@faws/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import * as React from "react";

import { KeyValue, KeyValueGrid } from "~/components/kv";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { RecordingsPanel } from "~/features/terminal/components/RecordingsPanel";
import {
  DEFAULT_LOG_GUTTER,
  DEFAULT_LOG_TASK_GUTTER,
  REFRESH_CHOICES,
  useAwsScope,
  useScope,
} from "~/contexts/ScopeContext";
import { useTheme } from "~/contexts/ThemeContext";
import { useWriteMode } from "~/hooks/useWriteMode";
import { trpc } from "~/lib/trpc";
import { recentActions, useRememberedList } from "~/stores/recents";
import { type SilenceEntry, useSilenced } from "~/stores/silenced";
import { resetSettings, useSettings } from "~/stores/settings";
import { cn } from "~/lib/utils";

/**
 * The two switches in front of every mutation.
 *
 * Read-only is the state this build starts in, and arming deletion is a
 * second, separate act: writing something new and destroying something that
 * was already there are different risks, and the session forgets the second
 * one when it ends.
 */
function WriteMode() {
  const { readOnly, destructive, setReadOnly, setDestructive } = useWriteMode();

  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge tone={readOnly ? "success" : destructive ? "danger" : "warning"}>
        {readOnly ? "read-only" : destructive ? "deletion armed" : "read-write"}
      </Badge>
      <Button size="sm" onClick={() => setReadOnly(!readOnly)}>
        {readOnly ? "Allow writes" : "Return to read-only"}
      </Button>
      {readOnly ? null : (
        <Button
          size="sm"
          variant={destructive ? "danger" : "outline"}
          onClick={() => setDestructive(!destructive)}
        >
          {destructive ? "Disarm deletion" : "Arm deletion"}
        </Button>
      )}
    </span>
  );
}

export function SettingsPage() {
  const scope = useAwsScope();
  const {
    refreshSeconds,
    setRefreshSeconds,
    logTimestamps,
    setLogTimestamps,
    logGutter,
    setLogGutter,
    logTaskGutter,
    setLogTaskGutter,
  } = useScope();
  const { theme, toggle } = useTheme();
  const persistence = useSettings((state) => state.persistence);

  const whoami = useQuery({ ...trpc.aws.whoami.queryOptions(scope), retry: false });

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
            <WriteMode />
          </KeyValue>
        </KeyValueGrid>
      </Panel>

      <RecordingsPanel />

      {/* The endpoints moved to their own page under S3, where they belong.
          The row stays because this is where they lived, and a section that
          vanishes from the place someone last saw it reads as removed. */}
      <Panel className="shrink-0">
        <PanelHeader>
          <PanelTitle>S3 endpoints</PanelTitle>
          <Link
            to="/s3/connections"
            className="ml-auto font-mono text-[10.5px] text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground"
          >
            manage endpoints
          </Link>
        </PanelHeader>
        <p className="px-3.5 py-2.5 text-[12.5px] text-muted-foreground">
          S3 compatible servers on your own network are managed under S3, alongside the buckets they
          serve.
        </p>
      </Panel>

      <SilencedPanel />

      <RememberedPanel />

      <Panel className="shrink-0">
        <PanelHeader>
          <PanelTitle>Preferences</PanelTitle>
          <button
            type="button"
            onClick={resetSettings}
            className="ml-auto cursor-pointer font-mono text-[10.5px] text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground"
          >
            reset all
          </button>
        </PanelHeader>
        {persistence.writable ? null : (
          <p className="border-b border-border bg-warning/10 px-3.5 py-2 text-[12px] text-muted-foreground">
            Preferences cannot be saved on this machine (
            <span className="font-mono text-[11px]">{persistence.reason}</span>). They still apply
            in every open window, but will reset when faws restarts.
          </p>
        )}
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

          <Setting
            title="Log timestamps"
            hint="Clock time is enough to follow a tail; the full stamp includes the date, for lining logs up against another system."
          >
            <div className="flex items-center gap-1">
              {(["clock", "full"] as const).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => setLogTimestamps(choice)}
                  className={cn(
                    "cursor-pointer rounded px-2 py-1 font-mono text-[11.5px] transition-colors",
                    choice === logTimestamps
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {choice}
                </button>
              ))}
            </div>
          </Setting>

          <Setting
            title="Log columns"
            hint="How much of each log line the timestamp and task id take before the message starts. Drag either column's edge in any log pane; these are the same numbers."
          >
            <div className="flex items-center gap-3">
              <GutterSetting
                label="time"
                value={logGutter}
                fallback={DEFAULT_LOG_GUTTER}
                onReset={() => setLogGutter(DEFAULT_LOG_GUTTER)}
              />
              <GutterSetting
                label="task"
                value={logTaskGutter}
                fallback={DEFAULT_LOG_TASK_GUTTER}
                onReset={() => setLogTaskGutter(DEFAULT_LOG_TASK_GUTTER)}
              />
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

/**
 * Everything the app has remembered about where you have been.
 *
 * It mirrors the silenced panel, and for the same reason: anything kept about
 * a person should be visible to them and clearable by them in one place. A
 * recents list that can only be added to is a history you cannot get out of.
 *
 * The list is scoped to the profile and region in view, like every other reader
 * of these maps. "Forget all" is deliberately not: it empties both maps for
 * every account, because the one place someone comes to clear their history
 * should clear their history rather than the part of it currently on screen.
 */
function RememberedPanel() {
  const rows = useRememberedList();

  return (
    <Panel className="shrink-0">
      <PanelHeader>
        <PanelTitle>Recent and pinned</PanelTitle>
        <span className="font-mono text-[11px] text-muted-foreground tabular">{rows.length}</span>
        {rows.length > 0 ? (
          <button
            type="button"
            onClick={() => recentActions.forgetAll("both")}
            className="ml-auto cursor-pointer font-mono text-[10.5px] text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground"
          >
            forget all
          </button>
        ) : null}
      </PanelHeader>

      {rows.length === 0 ? (
        <p className="px-3.5 py-4 text-[12.5px] text-muted-foreground">
          Nothing remembered in this account yet. Open a cluster, a service or a bucket and it
          appears here and in the sidebar; pin one to keep it there.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map(({ entry, key, pinned }) => (
            <li key={key} className="flex items-center gap-3 px-3.5 py-2">
              <Badge tone={pinned ? "primary" : "neutral"}>{pinned ? "pinned" : entry.kind}</Badge>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px]">{entry.label}</span>
                <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                  {entry.detail || entry.to}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground tabular">
                {relativeTime(entry.at)}
              </span>
              <button
                type="button"
                onClick={() => recentActions.forget(key)}
                className="shrink-0 cursor-pointer rounded border border-border px-2 py-0.5 text-[11.5px] transition-colors hover:bg-accent"
              >
                Forget
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** One column's current width, with a way back to the default. */
function GutterSetting({
  label,
  value,
  fallback,
  onReset,
}: {
  label: string;
  value: number;
  fallback: number;
  onReset: () => void;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-mono text-[11.5px] text-muted-foreground tabular">
        {label} {value}px
      </span>
      <button
        type="button"
        onClick={onReset}
        disabled={value === fallback}
        className="cursor-pointer rounded border border-border px-2 py-0.5 text-[11.5px] transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-45"
      >
        Reset
      </button>
    </span>
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
