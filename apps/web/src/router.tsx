import { useHotkeys } from "@tanstack/react-hotkeys";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import * as React from "react";
import { z } from "zod";

import { AppHeader } from "~/components/AppHeader";
import { AppSidebar } from "~/components/AppSidebar";
import { CommandPalette } from "~/components/CommandPalette";
import { KeyboardHelp } from "~/components/KeyboardHelp";
import { StatusBar } from "~/components/StatusBar";
import { installTrafficLightInset } from "~/lib/desktop";
import { useShortcutsSuspended } from "~/lib/shortcut-scope";
import { describe } from "~/lib/hotkeys";
import { useLogIngest } from "~/lib/log-store";
import { getSocket } from "~/lib/socket";
import { findService } from "~/services/registry";
import { CLUSTER_TABS, ClusterPage } from "~/features/ecs/pages/ClusterPage";
import { ClustersPage } from "~/features/ecs/pages/ClustersPage";
import { DeploymentsPage } from "~/features/ecs/pages/DeploymentsPage";
import { EcsIndexPage } from "~/features/ecs/pages/EcsIndexPage";
import { Ec2IndexPage } from "~/features/ec2/pages/Ec2IndexPage";
import { InstancesPage } from "~/features/ec2/pages/InstancesPage";
import { ContextsPage } from "~/features/kube/pages/ContextsPage";
import { KubeIndexPage } from "~/features/kube/pages/KubeIndexPage";
import { VirtualMachinesPage } from "~/features/kube/pages/VirtualMachinesPage";
import { WorkloadsPage } from "~/features/kube/pages/WorkloadsPage";
import { kubeScopeSearch } from "~/features/kube/scope-link";
import { HomePage } from "~/pages/HomePage";
import { NewSessionDialog } from "~/features/terminal/components/NewSessionDialog";
import { SessionsPage } from "~/features/terminal/pages/SessionsPage";
import { TerminalDock } from "~/features/terminal/components/TerminalDock";
import { blurTerminal } from "~/lib/terminal/xterm";
import { useSessions } from "~/stores/sessions";
import { LogsPage } from "~/pages/LogsPage";
import { SERVICE_TABS, ServicePage } from "~/features/ecs/pages/ServicePage";
import { BUCKET_TABS, BucketPage } from "~/features/s3/pages/BucketPage";
import { BucketsPage } from "~/features/s3/pages/BucketsPage";
import { ConnectionsPage } from "~/features/s3/pages/ConnectionsPage";
import { S3IndexPage } from "~/features/s3/pages/S3IndexPage";
import { SettingsPage } from "~/pages/SettingsPage";
import { TaskDefinitionsPage } from "~/features/ecs/pages/TaskDefinitionsPage";
import { TaskPage } from "~/features/ecs/pages/TaskPage";

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
 * The text in a page's filter box.
 *
 * Every list in the app has one, and it lives in the URL rather than in
 * component state: there it survives a refresh, it can be pasted to someone,
 * and the back button reaches it - `useFilterSearch` writes it and
 * every route that renders a filter declares it here so the router keeps it.
 */
const filterSearch = z.object({ q: z.string().max(200).optional().catch(undefined) });

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
  validateSearch: filterSearch,
  component: TaskDefinitionsPage,
});

const s3IndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s3",
  component: S3IndexPage,
});

const bucketsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s3/buckets",
  validateSearch: filterSearch,
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
  component: SessionsPage,
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
  ec2IndexRoute,
  ec2InstancesRoute,
  kubeIndexRoute,
  kubeContextsRoute,
  kubeWorkloadsRoute,
  kubeVirtualMachinesRoute,
  sessionsRoute,
  logsRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

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

function RootLayout() {
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [newSession, setNewSession] = React.useState<"closed" | "instance" | "ssh" | "kube">(
    "closed",
  );
  const { location } = useRouterState();

  // Capture server logs for the whole session, not just while /logs is open.
  useLogIngest();

  React.useEffect(() => installTrafficLightInset(), []);

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
          <Outlet />
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
