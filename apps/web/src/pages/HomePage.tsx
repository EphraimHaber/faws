import type { EcsCluster, EcsService } from "@faws/contracts";
import { relativeTime } from "@faws/shared";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Check, Layers, Rocket } from "lucide-react";
import * as React from "react";

import { CountMeter } from "~/components/meter";
import { PinButton } from "~/components/PinButton";
import { Badge } from "~/components/ui/badge";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelSearch, PanelTitle } from "~/components/ui/panel";
import { ScrollList } from "~/components/ui/scroll-list";
import { LoadingRows, Spinner } from "~/components/ui/spinner";
import { StatusDot } from "~/components/ui/status-dot";
import { TextAction } from "~/components/ui/text-action";
import { useAwsScope, useScope } from "~/contexts/ScopeContext";
import { clusterRef, serviceRef } from "~/features/ecs/refs";
import { serviceTone } from "~/lib/status";
import { trpc } from "~/lib/trpc";
import { HiddenCount, SilenceMenu } from "~/components/SilenceMenu";
import { AWS_SERVICES, resolveService, type AwsServiceDefinition } from "~/services/registry";
import { kindIcon } from "~/components/CommandPalette.entries";
import { usePinnedList, useRecentList } from "~/stores/recents";
import { partitionSilenced, useSilenced } from "~/stores/silenced";
import { cn } from "~/lib/utils";
import { useFilterSearch } from "~/hooks/useSearchState";

/**
 * The landing screen: pick an AWS service, then see what it looks like right
 * now in this account.
 *
 * The service strip leads because it is the widest choice on the page —
 * everything below it is an answer scoped to one service.
 */
export function HomePage() {
  const { service } = useSearch({ from: "/" });
  const navigate = useNavigate({ from: "/" });
  const active = resolveService(service);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <ServiceSwitcher
        active={active}
        onSelect={(next) =>
          void navigate({
            search: { service: next },
            // Flipping between services is browsing one page, not walking a
            // trail, so the back button keeps leading out of the overview
            // instead of rewinding every toggle.
            replace: true,
          })
        }
      />

      <JumpBackIn />

      {/* ECS is the only service with a dashboard behind it. The others are
          either built - in which case the overview points into them - or not,
          in which case it says so. Sending someone who picked S3 to "not built
          yet" was simply wrong: S3 is one of the two most finished sections. */}
      {active.id === "ecs" ? (
        <EcsOverview />
      ) : active.status === "available" ? (
        <AvailableService service={active} />
      ) : (
        <PlannedService service={active} />
      )}
    </div>
  );
}

/**
 * What you were last doing, above the service you are about to pick.
 *
 * The overview is the screen a cold session starts on, and a bare choice
 * between five services ignores that four of them may not have been touched
 * in a month. Pins first, then the last few places, because a pin is an answer
 * someone gave deliberately and recency is only a guess.
 *
 * Absent entirely until there is something in it: a panel headed "Jump back
 * in" with nothing under it is a worse first run than no panel.
 */
function JumpBackIn() {
  const pinned = usePinnedList(JUMP_BACK_CAP);
  const recent = useRecentList(JUMP_BACK_CAP - pinned.length);
  const rows = [...pinned, ...recent];

  if (rows.length === 0) return null;

  return (
    <Panel className="shrink-0">
      <PanelHeader>
        <PanelTitle>Jump back in</PanelTitle>
      </PanelHeader>
      <div className="grid gap-1 p-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => {
          const Icon = kindIcon(row.kind);
          return (
            <div
              key={row.to}
              className="group flex min-w-0 items-center rounded-md pr-1 transition-colors hover:bg-accent/60"
            >
              <Link
                to={row.to}
                className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-2.5 text-left"
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[12.5px]">{row.label}</span>
                  <span className="truncate font-mono text-[10.5px] text-muted-foreground">
                    {row.detail || row.kind}
                  </span>
                </span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/70">
                  {relativeTime(row.at)}
                </span>
              </Link>
              <PinButton quiet target={row} />
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/** Two rows of three on a wide window, which is a glance rather than a list. */
const JUMP_BACK_CAP = 6;

/** A row of services, one of which the page below belongs to. */
function ServiceSwitcher({
  active,
  onSelect,
}: {
  active: AwsServiceDefinition;
  onSelect: (id: string) => void;
}) {
  return (
    <Panel className="shrink-0">
      <div
        role="group"
        aria-label="AWS service"
        className="grid gap-1 p-1.5 sm:grid-cols-3 lg:grid-cols-5"
      >
        {AWS_SERVICES.map((service) => {
          const Icon = service.icon;
          const selected = service.id === active.id;
          return (
            <button
              key={service.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(service.id)}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors",
                selected
                  ? "border-primary/45 bg-accent"
                  : "border-transparent hover:border-border hover:bg-accent/50",
              )}
            >
              <Icon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  selected
                    ? "text-primary"
                    : service.status === "available"
                      ? "text-muted-foreground"
                      : "text-muted-foreground/45",
                )}
                strokeWidth={1.7}
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-[13px]">
                  {service.label}
                  {service.status === "planned" ? (
                    <span className="font-mono text-[9px] tracking-[0.18em] text-muted-foreground/60 uppercase">
                      soon
                    </span>
                  ) : null}
                </span>
                <span className="block text-[11.5px] leading-snug text-muted-foreground">
                  {service.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

/**
 * A service that is built but has no dashboard of its own yet.
 *
 * It offers the way in rather than a summary: the sections are real pages with
 * real contents, and the overview's job until one of them has numbers worth
 * putting here is to not be a dead end.
 */
function AvailableService({ service }: { service: AwsServiceDefinition }) {
  return (
    <Panel className="shrink-0">
      <PanelHeader>
        <PanelTitle>{service.label}</PanelTitle>
        <span className="font-mono text-[11px] text-muted-foreground">{service.description}</span>
      </PanelHeader>
      <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* A service whose page is its only destination still gets a way in. */}
        {(service.sections.length > 0
          ? service.sections
          : [{ id: service.id, label: service.label, icon: service.icon, to: service.basePath }]
        ).map((section) => (
          <Link
            key={section.id}
            to={section.to ?? service.basePath}
            className="group flex items-center gap-2.5 rounded-md border border-border p-3.5 transition-colors hover:border-primary/45 hover:bg-accent/50"
          >
            <section.icon className="size-4 text-muted-foreground" strokeWidth={1.7} />
            <span className="text-[13px]">{section.label}</span>
            <ArrowRight
              aria-hidden
              className="ml-auto size-3.5 text-muted-foreground/40 transition-colors group-hover:text-foreground"
              strokeWidth={1.8}
            />
          </Link>
        ))}
      </div>
    </Panel>
  );
}

/**
 * A service faws will cover but doesn't yet. It names the work rather than
 * apologising, so the gap reads as unbuilt rather than broken.
 */
function PlannedService({ service }: { service: AwsServiceDefinition }) {
  return (
    <Panel className="shrink-0">
      <PanelHeader>
        <PanelTitle>{service.label}</PanelTitle>
        <span className="font-mono text-[9px] tracking-[0.18em] text-muted-foreground/60 uppercase">
          soon
        </span>
      </PanelHeader>
      <EmptyState
        icon={service.icon}
        title={`${service.label} is not built yet`}
        hint={`Planned: ${service.description}.`}
      />
    </Panel>
  );
}

/** Everything the account's ECS footprint is doing, newest trouble first. */
function EcsOverview() {
  const scope = useAwsScope();
  const { profile, region } = useScope();

  const whoami = useQuery({ ...trpc.aws.whoami.queryOptions(scope), retry: false });
  const clusters = useQuery(trpc.ecs.clusters.queryOptions(scope));
  // Stable identity: `clusters.data ?? []` would be a fresh array each render
  // and re-run every memo below it.
  const clusterList = React.useMemo(() => clusters.data ?? [], [clusters.data]);

  // Services live per cluster, so a whole-account view means one query each.
  // They run in parallel and share the app's cache, so opening a cluster next
  // is instant rather than a second round trip.
  const serviceQueries = useQueries({
    queries: clusterList.map((cluster) => ({
      ...trpc.ecs.services.queryOptions({ ...scope, cluster: cluster.name }),
    })),
  });

  const loadingServices = serviceQueries.some((query) => query.isPending);
  const services = React.useMemo(
    () => serviceQueries.flatMap((query) => query.data ?? []),
    [serviceQueries],
  );

  const dismissed = useSilenced((state) => state.dismissed);
  const muted = useSilenced((state) => state.muted);
  const [showSilenced, setShowSilenced] = React.useState(false);
  // Both boxes are on screen together, so each needs a name of its own.
  const [clusterSearch, setClusterSearch] = useFilterSearch("clusters");
  const [recentSearch, setRecentSearch] = useFilterSearch("recent");

  const attention = React.useMemo(() => {
    const failing = services
      .filter(
        (service) =>
          service.rolloutState === "FAILED" ||
          service.failedTasks > 0 ||
          service.deploymentState === "degraded",
      )
      .toSorted((a, b) => (b.lastDeploymentAt ?? "").localeCompare(a.lastDeploymentAt ?? ""));
    return partitionSilenced({ dismissed, muted }, failing);
  }, [services, dismissed, muted]);

  const deploying = React.useMemo(
    () => services.filter((service) => service.deploymentState === "deploying"),
    [services],
  );

  const visibleClusters = React.useMemo(() => {
    const query = clusterSearch.trim().toLowerCase();
    return query.length === 0
      ? clusterList
      : clusterList.filter((cluster) => cluster.name.toLowerCase().includes(query));
  }, [clusterList, clusterSearch]);

  const recent = React.useMemo(() => {
    const query = recentSearch.trim().toLowerCase();
    return services
      .filter((service) => service.lastDeploymentAt)
      .filter(
        (service) =>
          query.length === 0 ||
          service.name.toLowerCase().includes(query) ||
          service.clusterName.toLowerCase().includes(query),
      )
      .toSorted((a, b) => (b.lastDeploymentAt ?? "").localeCompare(a.lastDeploymentAt ?? ""));
  }, [services, recentSearch]);

  const totals = React.useMemo(
    () => ({
      clusters: clusterList.length,
      services: services.length,
      running: clusterList.reduce((sum, cluster) => sum + cluster.runningTasks, 0),
      pending: clusterList.reduce((sum, cluster) => sum + cluster.pendingTasks, 0),
    }),
    [clusterList, services.length],
  );

  if (clusters.isError) {
    return (
      <Panel className="flex-1">
        <ErrorState error={clusters.error} onRetry={() => void clusters.refetch()} />
      </Panel>
    );
  }

  return (
    <>
      <Panel className="shrink-0">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 px-4 py-3.5">
          <Stat
            label="Account"
            value={whoami.data?.accountId ?? (whoami.isPending ? "…" : "not signed in")}
          />
          <Stat label="Profile" value={profile} />
          <Stat label="Region" value={region} />
          <span aria-hidden className="h-8 w-px bg-border" />
          <Stat label="Clusters" value={clusters.isPending ? "…" : String(totals.clusters)} />
          <Stat label="Services" value={loadingServices ? "…" : String(totals.services)} />
          <Stat label="Running tasks" value={clusters.isPending ? "…" : String(totals.running)} />
          {totals.pending > 0 ? (
            <Stat label="Pending" value={String(totals.pending)} tone="warning" />
          ) : null}
          {loadingServices ? <Spinner className="ml-auto" /> : null}
        </div>
      </Panel>

      {deploying.length > 0 ? (
        <Panel className="shrink-0 border-info/45">
          <PanelHeader className="bg-info/8">
            <StatusDot tone="info" pulse />
            <PanelTitle>Deploying now</PanelTitle>
            <span className="font-mono text-[11px] text-muted-foreground tabular">
              {deploying.length}
            </span>
          </PanelHeader>
          <ul className="flex flex-col divide-y divide-border">
            {deploying.map((service) => (
              <ServiceRow key={service.arn} service={service} />
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel className={cn("shrink-0", attention.visible.length > 0 && "border-danger/45")}>
        <PanelHeader className={attention.visible.length > 0 ? "bg-danger/8" : undefined}>
          {attention.visible.length > 0 ? (
            <AlertTriangle className="size-3.5 text-danger" strokeWidth={1.9} />
          ) : (
            <Check className="size-3.5 text-success" strokeWidth={2.2} />
          )}
          <PanelTitle>Needs attention</PanelTitle>
          <span className="font-mono text-[11px] text-muted-foreground tabular">
            {loadingServices ? "…" : attention.visible.length}
          </span>
          <div className="ml-auto">
            <HiddenCount
              count={attention.hidden.length}
              revealed={showSilenced}
              onReveal={() => setShowSilenced((prev) => !prev)}
            />
          </div>
        </PanelHeader>

        {loadingServices && attention.visible.length === 0 ? (
          <LoadingRows rows={3} />
        ) : attention.visible.length === 0 ? (
          <p className="px-4 py-5 text-[12.5px] text-muted-foreground">
            {attention.hidden.length > 0
              ? `Nothing unsilenced in ${region}.`
              : `No failed rollouts and no failing tasks in ${region}.`}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {attention.visible.map((service) => (
              <ServiceRow key={service.arn} service={service} silenceable />
            ))}
          </ul>
        )}

        {showSilenced && attention.hidden.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border border-t border-border opacity-55">
            {attention.hidden.map((service) => (
              <ServiceRow key={service.arn} service={service} silenced />
            ))}
          </ul>
        ) : null}
      </Panel>

      <div className="grid shrink-0 gap-3 lg:grid-cols-2">
        <Panel>
          <PanelHeader>
            <Rocket className="size-3.5 text-muted-foreground" strokeWidth={1.8} />
            <PanelTitle>
              <Link to="/ecs/deployments" className="transition-colors hover:text-foreground">
                Recently deployed
              </Link>
            </PanelTitle>
            <div className="ml-auto">
              <PanelSearch
                value={recentSearch}
                onChange={setRecentSearch}
                placeholder="Search services…"
              />
            </div>
          </PanelHeader>
          {loadingServices && recent.length === 0 ? (
            <LoadingRows rows={4} />
          ) : (
            <ScrollList
              className="max-h-96"
              items={recent}
              itemKey={(service) => service.arn}
              label="services"
              renderItem={(service) => <ServiceRow service={service} compact />}
              emptyState={
                <p className="px-4 py-5 text-[12.5px] text-muted-foreground">
                  {recentSearch
                    ? `No deployed service matches "${recentSearch}".`
                    : "Nothing has deployed in this region."}
                </p>
              }
            />
          )}
        </Panel>

        <Panel>
          <PanelHeader>
            <Layers className="size-3.5 text-muted-foreground" strokeWidth={1.8} />
            <PanelTitle>
              <Link to="/ecs/clusters" className="transition-colors hover:text-foreground">
                Clusters
              </Link>
            </PanelTitle>
            <div className="ml-auto">
              <PanelSearch
                value={clusterSearch}
                onChange={setClusterSearch}
                placeholder="Search clusters…"
              />
            </div>
          </PanelHeader>
          {clusters.isPending ? (
            <LoadingRows rows={4} />
          ) : (
            <ScrollList
              className="max-h-96"
              items={visibleClusters}
              itemKey={(cluster) => cluster.arn}
              label="clusters"
              renderItem={(cluster) => <ClusterRow cluster={cluster} />}
              emptyState={
                <p className="px-4 py-5 text-[12.5px] text-muted-foreground">
                  {clusterSearch
                    ? `No cluster matches "${clusterSearch}".`
                    : `No ECS clusters in ${region}.`}
                </p>
              }
            />
          )}
        </Panel>
      </div>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warning" }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[9.5px] tracking-[0.24em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className={cn("font-mono text-[15px] tabular", tone === "warning" && "text-warning")}>
        {value}
      </p>
    </div>
  );
}

function ServiceRow({
  service,
  compact = false,
  silenceable = false,
  silenced = false,
}: {
  service: EcsService;
  compact?: boolean;
  silenceable?: boolean;
  silenced?: boolean;
}) {
  const navigate = useNavigate();
  const scope = useAwsScope();
  const restore = useSilenced((state) => state.restore);
  const tone = serviceTone(service.deploymentState);

  return (
    <li className="group/row flex items-center">
      <button
        type="button"
        onClick={() =>
          void navigate({
            to: "/ecs/clusters/$cluster/services/$service",
            params: { cluster: service.clusterName, service: service.name },
          })
        }
        className="group flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-2 pr-2 pl-4 text-left transition-colors hover:bg-accent"
      >
        <StatusDot tone={tone.tone} pulse={tone.pulse} />
        <span className="min-w-0 flex-1 truncate text-[12.5px]">{service.name}</span>
        <span className="hidden shrink-0 font-mono text-[10.5px] text-muted-foreground sm:inline">
          {service.clusterName}
        </span>

        {service.rolloutState === "FAILED" ? (
          <Badge tone="danger">rollout failed</Badge>
        ) : service.failedTasks > 0 ? (
          <Badge tone="warning">{service.failedTasks} failed</Badge>
        ) : null}

        {!compact ? (
          <CountMeter
            running={service.runningCount}
            desired={service.desiredCount}
            pending={service.pendingCount}
          />
        ) : null}

        <span
          className="w-24 shrink-0 text-right font-mono text-[10.5px] text-muted-foreground tabular"
          title={service.lastDeploymentAt ?? undefined}
        >
          {relativeTime(service.lastDeploymentAt)}
        </span>
        <ArrowRight className="size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
      </button>

      <PinButton
        quiet
        target={serviceRef(service.clusterName, service.name, scope)}
        className={cn("group-hover/row:opacity-100", !silenceable && !silenced && "mr-2")}
      />

      {silenceable ? (
        <span className="shrink-0 pr-2.5 pl-1">
          <SilenceMenu service={service} />
        </span>
      ) : null}
      {silenced ? (
        <TextAction
          onClick={() => restore(service.arn)}
          className="shrink-0 py-2 pr-3.5 pl-1 text-[10px]"
        >
          restore
        </TextAction>
      ) : null}
    </li>
  );
}

function ClusterRow({ cluster }: { cluster: EcsCluster }) {
  const scope = useAwsScope();
  return (
    <li className="group/row flex items-center pr-2 transition-colors hover:bg-accent">
      <Link
        to="/ecs/clusters/$cluster"
        params={{ cluster: cluster.name }}
        className="group flex min-w-0 flex-1 items-center gap-3 py-2 pl-4"
      >
        <StatusDot
          tone={cluster.status === "ACTIVE" ? "success" : "neutral"}
          pulse={cluster.pendingTasks > 0}
        />
        <span className="min-w-0 flex-1 truncate text-[12.5px]">{cluster.name}</span>
        <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground tabular">
          {cluster.activeServices} svc · {cluster.runningTasks} running
        </span>
        <ArrowRight className="size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
      </Link>
      <PinButton
        quiet
        target={clusterRef(cluster.name, scope)}
        className="group-hover/row:opacity-100"
      />
    </li>
  );
}
