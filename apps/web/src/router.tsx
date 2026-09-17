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
import { useOverlaysOpen } from "~/stores/overlays";
import { describe } from "~/lib/hotkeys";
import { useLogIngest } from "~/lib/log-store";
import { getSocket } from "~/lib/socket";
import { findService } from "~/services/registry";
import { CLUSTER_TABS, ClusterPage } from "~/features/ecs/pages/ClusterPage";
import { ClustersPage } from "~/features/ecs/pages/ClustersPage";
import { DeploymentsPage } from "~/features/ecs/pages/DeploymentsPage";
import { EcsIndexPage } from "~/features/ecs/pages/EcsIndexPage";
import { HomePage } from "~/pages/HomePage";
import { LogsPage } from "~/pages/LogsPage";
import { SERVICE_TABS, ServicePage } from "~/features/ecs/pages/ServicePage";
import { BucketPage } from "~/features/s3/pages/BucketPage";
import { BucketsPage } from "~/features/s3/pages/BucketsPage";
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
  validateSearch: z
    .object({ service: z.string().optional().catch(undefined) })
    .transform(({ service }): { service?: string } => {
      const match = service ? findService(service) : undefined;
      return match ? { service: match.id } : {};
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
  return logSearch.extend({ tab: z.enum(tabs).optional().catch(undefined) });
}

const clustersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ecs/clusters",
  component: ClustersPage,
});

const deploymentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ecs/deployments",
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
  component: BucketsPage,
});

const bucketRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s3/buckets/$bucket",
  component: BucketRoute,
});

const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/logs",
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

  const overlayOpen = useOverlaysOpen();

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
      <StatusBar onShowHelp={() => setHelpOpen(true)} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        activeCluster={activeCluster}
      />
      <KeyboardHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
