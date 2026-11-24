import {
  CLOUDWATCH_WINDOWS,
  MAX_TAILED_GROUPS,
  METRIC_STATISTICS,
  REST_API_EXPORT_FORMATS,
} from "@faws/contracts";
import { useHotkeys } from "@tanstack/react-hotkeys";
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import * as React from "react";
import { z } from "zod";

import { AppHeader } from "~/components/AppHeader";
import { AppSidebar } from "~/components/AppSidebar";
import { ProviderGate } from "~/components/ProviderGate";
import { LoadingRows } from "~/components/ui/spinner";
import { WelcomePage } from "~/pages/WelcomePage";
import { UpdatedBanner } from "~/components/UpdatedBanner";
import { initUpdates } from "~/stores/updates";
import { useUpdatesConfig } from "~/hooks/useUpdatesConfig";
import { useDesktopMenu } from "~/hooks/useDesktopMenu";
import { useKubeDiagnostics } from "~/features/kube/useKubeDiagnostics";
import { useSettings } from "~/stores/settings";
import { CommandPalette } from "~/components/CommandPalette";
import { KeyboardHelp } from "~/components/KeyboardHelp";
import { StatusBar } from "~/components/StatusBar";
import { installTrafficLightInset } from "~/lib/desktop";
import { useShortcutsSuspended } from "~/lib/shortcut-scope";
import { describe } from "~/lib/hotkeys";
import { useLogIngest } from "~/lib/log-store";
import { getSocket } from "~/lib/socket";
import { findService } from "~/services/registry";
import { REST_API_TABS, RestApiPage } from "~/features/api-gateway/pages/RestApiPage";
import { USAGE_PLAN_TABS, UsagePlansPage } from "~/features/api-gateway/pages/UsagePlansPage";
import { STAGE_LOG_KINDS } from "~/features/api-gateway/stages";
import { CLUSTER_TABS, ClusterPage } from "~/features/ecs/pages/ClusterPage";
import { kubeScopeSearch } from "~/features/kube/scope-link";
import { HomePage } from "~/pages/HomePage";
import { NewSessionDialog } from "~/features/terminal/components/NewSessionDialog";
import { TerminalDock } from "~/features/terminal/components/TerminalDock";
import { blurTerminal } from "~/lib/terminal/xterm";
import { useSessions } from "~/stores/sessions";
import { SERVICE_TABS, ServicePage } from "~/features/ecs/pages/ServicePage";
import { BUCKET_TABS, BucketPage } from "~/features/s3/pages/BucketPage";

/**
 * Every page but the two a session can open on is its own chunk, fetched the
 * first time it is needed - or earlier, when a link to it is hovered, which is
 * what `defaultPreload: "intent"` does. The shell paints without waiting for
 * Monaco, xterm or any one feature's code.
 */
const WhatsNewPage = lazyRouteComponent(() => import("~/pages/WhatsNewPage"), "WhatsNewPage");
const ApiGatewayIndexPage = lazyRouteComponent(
  () => import("~/features/api-gateway/pages/ApiGatewayIndexPage"),
  "ApiGatewayIndexPage",
);
const DomainsPage = lazyRouteComponent(
  () => import("~/features/api-gateway/pages/DomainsPage"),
  "DomainsPage",
);
const RestApisPage = lazyRouteComponent(
  () => import("~/features/api-gateway/pages/RestApisPage"),
  "RestApisPage",
);
const CloudWatchIndexPage = lazyRouteComponent(
  () => import("~/features/cloudwatch/pages/CloudWatchIndexPage"),
  "CloudWatchIndexPage",
);
const LogGroupPage = lazyRouteComponent(
  () => import("~/features/cloudwatch/pages/LogGroupPage"),
  "LogGroupPage",
);
const LogGroupsPage = lazyRouteComponent(
  () => import("~/features/cloudwatch/pages/LogGroupsPage"),
  "LogGroupsPage",
);
const MetricsPage = lazyRouteComponent(
  () => import("~/features/cloudwatch/pages/MetricsPage"),
  "MetricsPage",
);
const TailPage = lazyRouteComponent(
  () => import("~/features/cloudwatch/pages/TailPage"),
  "TailPage",
);
const ClustersPage = lazyRouteComponent(
  () => import("~/features/ecs/pages/ClustersPage"),
  "ClustersPage",
);
const DeploymentsPage = lazyRouteComponent(
  () => import("~/features/ecs/pages/DeploymentsPage"),
  "DeploymentsPage",
);
const EcsIndexPage = lazyRouteComponent(
  () => import("~/features/ecs/pages/EcsIndexPage"),
  "EcsIndexPage",
);
const Ec2IndexPage = lazyRouteComponent(
  () => import("~/features/ec2/pages/Ec2IndexPage"),
  "Ec2IndexPage",
);
const InstancesPage = lazyRouteComponent(
  () => import("~/features/ec2/pages/InstancesPage"),
  "InstancesPage",
);
const ContextsPage = lazyRouteComponent(
  () => import("~/features/kube/pages/ContextsPage"),
  "ContextsPage",
);
const KubeIndexPage = lazyRouteComponent(
  () => import("~/features/kube/pages/KubeIndexPage"),
  "KubeIndexPage",
);
const VirtualMachinesPage = lazyRouteComponent(
  () => import("~/features/kube/pages/VirtualMachinesPage"),
  "VirtualMachinesPage",
);
const WorkloadsPage = lazyRouteComponent(
  () => import("~/features/kube/pages/WorkloadsPage"),
  "WorkloadsPage",
);
const RecordingsPage = lazyRouteComponent(
  () => import("~/features/terminal/pages/RecordingsPage"),
  "RecordingsPage",
);
const SessionsPage = lazyRouteComponent(
  () => import("~/features/terminal/pages/SessionsPage"),
  "SessionsPage",
);
const LogsPage = lazyRouteComponent(() => import("~/pages/LogsPage"), "LogsPage");
const BucketsPage = lazyRouteComponent(
  () => import("~/features/s3/pages/BucketsPage"),
  "BucketsPage",
);
const ConnectionsPage = lazyRouteComponent(
  () => import("~/features/s3/pages/ConnectionsPage"),
  "ConnectionsPage",
);
const S3IndexPage = lazyRouteComponent(
  () => import("~/features/s3/pages/S3IndexPage"),
  "S3IndexPage",
);
const SettingsPage = lazyRouteComponent(() => import("~/pages/SettingsPage"), "SettingsPage");
const TaskDefinitionsPage = lazyRouteComponent(
  () => import("~/features/ecs/pages/TaskDefinitionsPage"),
  "TaskDefinitionsPage",
);
const TaskPage = lazyRouteComponent(() => import("~/features/ecs/pages/TaskPage"), "TaskPage");

const rootRoute = createRootRoute({ component: RootLayout });

// Everything AWS-service-specific lives under that service's own prefix, so
// adding /s3 or /lambda later is additive rather than a re-shuffle. `/` sits
// above them all: it summarises the account one service at a time.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  // Which service the overview is showing rides in the URL so it survives a
  // reload and can be pasted to someone else. An id no longer in the registry
  // is dropped here and the page falls back to its default, so a stale link
  // still opens on something.
  // Two filter boxes are on screen at once here, so they cannot share `q`.
  validateSearch: z
    .object({
      service: z.string().optional().catch(undefined),
      clusters: z.string().max(200).optional().catch(undefined),
      recent: z.string().max(200).optional().catch(undefined),
    })
    .transform(({ service, ...rest }) => {
      const match = service ? findService(service) : undefined;
      return { ...rest, ...(match ? { service: match.id } : {}) };
    }),
  component: HomePage,
});

const ecsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ecs",
  component: EcsIndexPage,
});

/**
 * Whether the log pane shows which task each line came from.
 *
 * It rides in the URL for the same reason the overview's service does: a
 * reading preference that survives a reload, and a link that opens on the
 * same view the sender was looking at.
 */
const logSearch = z.object({ stream: z.literal("hidden").optional().catch(undefined) });

/**
 * Which tab a tabbed page has open, validated against that page's own list, so
 * a link carrying a tab the page no longer has opens on its default instead of
 * on nothing. `catch` is what makes that a fallback rather than a thrown
 * error: a URL someone edited by hand still opens the page.
 */
function tabSearch<const T extends readonly [string, ...string[]]>(tabs: T) {
  return logSearch
    .extend(filterSearch.shape)
    .extend({ tab: z.enum(tabs).optional().catch(undefined) });
}

/**
 * How a page's list is being looked at: its filter text, its sort, and which
 * columns it shows in what order.
 *
 * In the URL rather than in component state: there it survives a refresh, it
 * can be pasted to someone, and the back button reaches it. `useFilterSearch`
 * writes the filter and `DataTable` the rest, and every route that renders a
 * list declares these here so the router keeps them.
 */
const filterSearch = z.object({
  q: z.string().max(200).optional().catch(undefined),
  /** The table's sort: a column id, with a leading `-` for descending. */
  sort: z.string().max(80).optional().catch(undefined),
  /** The table's visible columns, in order, comma separated. */
  cols: z.string().max(2000).optional().catch(undefined),
});

const clustersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ecs/clusters",
  validateSearch: filterSearch,
  component: ClustersPage,
});

const deploymentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ecs/deployments",
  validateSearch: filterSearch,
  component: DeploymentsPage,
});

const clusterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ecs/clusters/$cluster",
  validateSearch: tabSearch(CLUSTER_TABS),
  component: ClusterRoute,
});

const serviceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ecs/clusters/$cluster/services/$service",
  validateSearch: tabSearch(SERVICE_TABS),
  component: ServiceRoute,
});

const taskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ecs/clusters/$cluster/tasks/$taskId",
  validateSearch: logSearch,
  component: TaskRoute,
});

const taskDefinitionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ecs/task-definitions",
  validateSearch: filterSearch.extend({
    family: z.string().max(255).optional().catch(undefined),
  }),
  component: TaskDefinitionsPage,
});

/**
 * Which saved endpoint the storage pages read, by id. Absent reads AWS through
 * the profile and region in the title bar, so a link names its storage system
 * and every existing `/s3/...` link still lands on AWS.
 */
const storageSearch = z.object({
  connection: z.string().min(1).max(512).optional().catch(undefined),
});

const s3IndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s3",
  validateSearch: storageSearch,
  component: S3IndexPage,
});

const bucketsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s3/buckets",
  validateSearch: filterSearch.extend(storageSearch.shape),
  component: BucketsPage,
});

/**
 * Which prefix the browser is open at.
 *
 * It rides in a search param rather than in the path, because an object key
 * may contain any character at all - `#`, `?` and `%` included - and those
 * survive a query string intact while a path segment has to be encoded twice
 * to carry them.
 */
const bucketRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s3/buckets/$bucket",
  validateSearch: filterSearch.extend({
    ...storageSearch.shape,
    prefix: z.string().max(1024).optional().catch(undefined),
    /** The key open in the viewer, so a link can carry one object. */
    object: z.string().max(1024).optional().catch(undefined),
    /**
     * The recursive scan's pattern - the text of it, not the fact that it ran.
     * A link can describe a search without the page arriving and billing for
     * it, so this pre-fills the box and waits to be applied.
     */
    scan: z.string().max(1024).optional().catch(undefined),
    tab: z.enum(BUCKET_TABS).optional().catch(undefined),
  }),
  component: BucketRoute,
});

const s3ConnectionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s3/connections",
  component: ConnectionsPage,
});

const cloudwatchIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cloudwatch",
  component: CloudWatchIndexPage,
});

const logGroupsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cloudwatch/log-groups",
  validateSearch: filterSearch.extend({
    /** Ticked groups, to be tailed together. */
    sel: z.string().max(8000).optional().catch(undefined),
  }),
  component: LogGroupsPage,
});

/**
 * How far back a CloudWatch page reads, from the fixed set it offers. Coerced,
 * because the page writes it as text and the URL hands it back as either.
 */
const windowSearch = z.coerce
  .number()
  .pipe(z.literal(CLOUDWATCH_WINDOWS))
  .optional()
  .catch(undefined);

/**
 * A log group's name is a path of its own - `/aws/lambda/api` - so it rides
 * as one percent-encoded segment, and the breadcrumb decodes it back whole.
 * The stream is `logStream` because `stream` already means the ECS log pane's
 * task column.
 */
const logGroupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cloudwatch/log-groups/$group",
  validateSearch: logSearch.extend({
    logStream: z.string().max(512).optional().catch(undefined),
    window: windowSearch,
    /** The stream list down the side, hidden. */
    streams: z.literal("hidden").optional().catch(undefined),
  }),
  component: LogGroupRoute,
});

/**
 * Several log groups tailed at once. The groups are a list rather than a
 * comma-joined string because a group name may be any path, and the router
 * encodes a list whole.
 */
const tailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cloudwatch/tail",
  validateSearch: logSearch.extend({
    groups: z.array(z.string().min(1).max(512)).max(MAX_TAILED_GROUPS).optional().catch(undefined),
    window: windowSearch,
    layout: z.literal("split").optional().catch(undefined),
  }),
  component: TailPage,
});

const metricsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cloudwatch/metrics",
  validateSearch: filterSearch.extend({
    ns: z.string().max(255).optional().catch(undefined),
    /** The charted metric, whole: a metric is its name and every dimension. */
    chart: z
      .object({
        namespace: z.string().min(1).max(255),
        name: z.string().min(1).max(255),
        dimensions: z
          .array(z.object({ name: z.string().min(1).max(255), value: z.string().max(1024) }))
          .max(30),
      })
      .optional()
      .catch(undefined),
    window: windowSearch,
    /** What the chart draws; absent, the average under the maximum. */
    stat: z.enum(METRIC_STATISTICS).optional().catch(undefined),
  }),
  component: MetricsPage,
});

const apiGatewayIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/api-gateway",
  component: ApiGatewayIndexPage,
});

const restApisRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/api-gateway/rest-apis",
  validateSearch: filterSearch,
  component: RestApisPage,
});

const restApiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/api-gateway/rest-apis/$apiId",
  validateSearch: tabSearch(REST_API_TABS).extend({
    /** The resource picked in the resources tab, by id. */
    resource: z.string().max(64).optional().catch(undefined),
    /** The stage picked in the stages, export, metrics and logs tabs, by name. */
    stage: z.string().max(128).optional().catch(undefined),
    /** The definition format picked in the export tab. */
    format: z.enum(REST_API_EXPORT_FORMATS).optional().catch(undefined),
    /** How far back the metrics tab reads. */
    window: windowSearch,
    /**
     * How far back the logs tab reads. Its own param, so a day picked for the
     * charts never turns into a day of log lines to read.
     */
    logWindow: windowSearch,
    /** Which of the stage's logs the logs tab reads. */
    log: z.enum(STAGE_LOG_KINDS).optional().catch(undefined),
  }),
  component: RestApiRoute,
});

const domainsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/api-gateway/domains",
  validateSearch: filterSearch.extend({
    /** The picked domain: its name, or `name+id` for a private one. */
    domain: z.string().max(320).optional().catch(undefined),
  }),
  component: DomainsPage,
});

const usagePlansRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/api-gateway/usage-plans",
  validateSearch: tabSearch(USAGE_PLAN_TABS).extend({
    /** The picked usage plan, by id. */
    plan: z.string().max(64).optional().catch(undefined),
  }),
  component: UsagePlansPage,
});

const ec2IndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ec2",
  component: Ec2IndexPage,
});

const ec2InstancesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ec2/instances",
  validateSearch: filterSearch,
  component: InstancesPage,
});

/**
 * `/kubernetes`, never `/k8s` and never anything with "cluster" in it: the
 * word belongs to ECS everywhere else here, and `/ecs/clusters` owns it.
 */
const kubeIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/kubernetes",
  component: KubeIndexPage,
});

const kubeContextsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/kubernetes/contexts",
  validateSearch: filterSearch,
  component: ContextsPage,
});

const kubeWorkloadsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/kubernetes/workloads",
  validateSearch: filterSearch.extend(kubeScopeSearch.shape),
  component: WorkloadsPage,
});

const kubeVirtualMachinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/kubernetes/virtual-machines",
  validateSearch: filterSearch,
  component: VirtualMachinesPage,
});

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions",
  validateSearch: filterSearch,
  component: SessionsPage,
});

const sessionRecordingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions/recordings",
  component: RecordingsPage,
});

const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/logs",
  validateSearch: filterSearch,
  component: LogsPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const whatsNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/whats-new",
  component: WhatsNewPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  ecsIndexRoute,
  clustersRoute,
  deploymentsRoute,
  clusterRoute,
  serviceRoute,
  taskRoute,
  taskDefinitionsRoute,
  s3IndexRoute,
  bucketsRoute,
  bucketRoute,
  s3ConnectionsRoute,
  cloudwatchIndexRoute,
  logGroupsRoute,
  logGroupRoute,
  tailRoute,
  metricsRoute,
  apiGatewayIndexRoute,
  restApisRoute,
  restApiRoute,
  domainsRoute,
  usagePlansRoute,
  ec2IndexRoute,
  ec2InstancesRoute,
  kubeIndexRoute,
  kubeContextsRoute,
  kubeWorkloadsRoute,
  kubeVirtualMachinesRoute,
  sessionsRoute,
  sessionRecordingsRoute,
  logsRoute,
  settingsRoute,
  whatsNewRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  // A chunk that arrives within this long never flashes a placeholder.
  defaultPendingMs: 150,
  defaultPendingComponent: PagePending,
});

function PagePending() {
  return <LoadingRows />;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function ClusterRoute() {
  const { cluster } = clusterRoute.useParams();
  return <ClusterPage cluster={cluster} />;
}

function ServiceRoute() {
  const { cluster, service } = serviceRoute.useParams();
  return <ServicePage cluster={cluster} service={service} />;
}

function TaskRoute() {
  const { cluster, taskId } = taskRoute.useParams();
  return <TaskPage cluster={cluster} taskId={taskId} />;
}

function BucketRoute() {
  const { bucket } = bucketRoute.useParams();
  return <BucketPage bucket={bucket} />;
}

function LogGroupRoute() {
  const { group } = logGroupRoute.useParams();
  return <LogGroupPage group={group} />;
}

function RestApiRoute() {
  const { apiId } = restApiRoute.useParams();
  return <RestApiPage apiId={apiId} />;
}

/**
 * The first-run screen until someone has picked what to connect to, then the
 * app. Waits for settings so a returning user never sees it flash.
 */
function RootLayout() {
  const ready = useSettings((state) => state.ready);
  const onboarded = useSettings((state) => state.settings.onboarding.completed);
  if (ready && !onboarded) return <WelcomePage />;
  return <AppShell />;
}

function AppShell() {
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [newSession, setNewSession] = React.useState<"closed" | "instance" | "ssh" | "kube">(
    "closed",
  );
  const { location } = useRouterState();

  // Capture server logs for the whole session, not just while /logs is open.
  useLogIngest();

  React.useEffect(() => installTrafficLightInset(), []);
  React.useEffect(() => initUpdates(), []);
  useUpdatesConfig();

  const kubeVirt = useKubeDiagnostics().data?.kubeVirt ?? false;
  useDesktopMenu(React.useMemo(() => ({ kubernetes: { kubevirt: kubeVirt } }), [kubeVirt]));

  // The desktop menu navigates by posting to the server, which fans the
  // target out as a `nav` event. The path comes from our own menu table.
  React.useEffect(() => {
    const socket = getSocket();
    const handler = (payload: { target: string }) => {
      void router.navigate({ to: payload.target as never });
    };
    socket.on("nav", handler);
    return () => {
      socket.off("nav", handler);
    };
  }, []);

  const activeCluster = React.useMemo(() => {
    const match = /^\/ecs\/clusters\/([^/]+)/.exec(location.pathname);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }, [location.pathname]);

  const overlayOpen = useShortcutsSuspended();

  const dockSessions = useSessions((state) => state.sessions);
  const dockActiveId = useSessions((state) => state.activeId);
  const dockOpen = useSessions((state) => state.dockOpen);
  const toggleDock = useSessions((state) => state.toggleDock);
  const toggleFullscreen = useSessions((state) => state.toggleFullscreen);
  const activateRelative = useSessions((state) => state.activateRelative);
  const closeSession = useSessions((state) => state.close);
  const hasSessions = dockSessions.length > 0;
  const restoreSessions = useSessions((state) => state.restore);

  // Tabs that were open before a reload ask the server to resume them. Run
  // once, before anything can open a new one.
  React.useEffect(() => {
    restoreSessions();
  }, [restoreSessions]);

  useHotkeys(
    [
      {
        // Toggling, so it stays live while the palette itself is open.
        hotkey: "Mod+K",
        callback: () => setPaletteOpen((prev) => !prev),
        options: { meta: describe("Navigation", "Jump to anything") },
      },
      {
        // `?` is the character the key produces, not Shift+/ - typed hotkey
        // strings exclude shifted punctuation because it is layout-dependent,
        // so this one is declared in raw form.
        hotkey: { key: "?" },
        callback: () => setHelpOpen((prev) => !prev),
        options: { enabled: !overlayOpen || helpOpen, meta: describe("Context", "This help") },
      },
      {
        // F1 is the conventional help key, and `ignoreInputs: false` keeps it
        // working from inside the filter box - it is never a character
        // someone is trying to type.
        hotkey: "F1",
        callback: () => setHelpOpen((prev) => !prev),
        options: {
          ignoreInputs: false,
          enabled: !overlayOpen || helpOpen,
          meta: describe("Context", "This help"),
        },
      },
      {
        // Bottom of the Escape stack: overlays and the filter box each answer
        // it first via their own registration, so by the time it reaches here
        // there is nothing open and Escape means "go back".
        hotkey: "Escape",
        callback: () => void router.history.back(),
        options: {
          enabled: !overlayOpen,
          conflictBehavior: "allow",
          meta: describe("Navigation", "Back one level"),
        },
      },
      {
        hotkey: "H",
        callback: () => void router.history.back(),
        options: { enabled: !overlayOpen, meta: describe("Navigation", "Back one level") },
      },
      // Every terminal binding sets `ignoreInputs: false`, because xterm's
      // input sink is a real textarea and these have to work from inside it.
      {
        // Backtick is shifted punctuation on some layouts, so the typed hotkey
        // strings exclude it - declared raw, exactly as `?` is above.
        hotkey: { key: "`", ctrl: true },
        callback: () => toggleDock(),
        options: {
          ignoreInputs: false,
          enabled: hasSessions,
          meta: describe("Terminal", "Show or hide the terminal dock"),
        },
      },
      {
        hotkey: "Mod+Escape",
        callback: () => {
          if (dockActiveId) blurTerminal(dockActiveId);
        },
        options: {
          ignoreInputs: false,
          enabled: hasSessions,
          meta: describe("Terminal", "Leave the terminal", "Returns focus to the page"),
        },
      },
      {
        hotkey: "Mod+Alt+]",
        callback: () => activateRelative(1),
        options: {
          ignoreInputs: false,
          enabled: hasSessions,
          meta: describe("Terminal", "Next terminal tab"),
        },
      },
      {
        hotkey: "Mod+Alt+[",
        callback: () => activateRelative(-1),
        options: {
          ignoreInputs: false,
          enabled: hasSessions,
          meta: describe("Terminal", "Previous terminal tab"),
        },
      },
      {
        hotkey: "Mod+Alt+Enter",
        callback: () => toggleFullscreen(),
        options: {
          ignoreInputs: false,
          enabled: hasSessions && dockOpen,
          meta: describe("Terminal", "Fill the window with the terminal"),
        },
      },
      {
        hotkey: "Mod+Alt+W",
        callback: () => {
          if (dockActiveId) closeSession(dockActiveId);
        },
        options: {
          ignoreInputs: false,
          enabled: hasSessions,
          meta: describe("Terminal", "Close this terminal tab"),
        },
      },
    ],
    { preventDefault: true },
  );

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      <AppHeader onOpenPalette={() => setPaletteOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <AppSidebar />
        <main className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
          <UpdatedBanner />
          <ProviderGate pathname={location.pathname}>
            <Outlet />
          </ProviderGate>
        </main>
      </div>
      <TerminalDock />
      <NewSessionDialog
        open={newSession !== "closed"}
        initialMode={newSession === "closed" ? "instance" : newSession}
        onClose={() => setNewSession("closed")}
      />
      <StatusBar
        onShowHelp={() => setHelpOpen(true)}
        onOpenTerminal={() => setNewSession("instance")}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        activeCluster={activeCluster}
        onOpenTerminal={() => setNewSession("instance")}
        onOpenSsh={() => setNewSession("ssh")}
        onOpenKube={() => setNewSession("kube")}
      />
      <KeyboardHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
