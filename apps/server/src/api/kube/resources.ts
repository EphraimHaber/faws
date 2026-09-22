/**
 * What a context can be asked about, flattened for the tables that read it.
 *
 * Every call here is `kubectl get ... -o json` through `runKubeJson`, for the
 * reason `binaries.ts` states at length: the tool that will run the shell is
 * the tool that should answer whether the shell can run. A client library with
 * a different set of supported authentications would list pods this app then
 * could not reach, which is the worst failure this feature can have.
 *
 * The flattening happens here rather than in the components, matching `s3.ts`
 * and `ExecInstanceTarget`: a pod's readiness lives in three places at once -
 * the phase, the container statuses, and whether a status belongs to an init
 * container - and two screens deriving "can I press Shell" separately would
 * eventually derive it differently.
 */
import type {
  KubeContainerInfo,
  KubeNamespaceInfo,
  KubePodInfo,
  KubeVirtualMachineInfo,
} from "@faws/contracts";

import { resolveKubeBinary } from "./binaries.ts";
import { runKubeJson, runKubeText } from "./cli.ts";
import { ExecSessionError } from "../exec/errors.ts";
import { translateKubeError } from "../exec/kube/translate.ts";
import { assertKnownContext, pinnedKubeconfig } from "./kubeconfig.ts";

export interface KubeScope {
  readonly context: string;
  readonly namespace: string;
}

/** What this cluster has, so the UI can hide what it does not. */
export interface KubeCapabilities {
  readonly openShift: boolean;
  readonly kubeVirt: boolean;
}

/**
 * The reading tool, and the flags that aim it.
 *
 * `kubectl` is preferred over `oc` even on OpenShift, since `oc get` is
 * `kubectl get` with extra subcommands - and falling back to `oc` means a
 * machine with only the OpenShift CLI installed still gets every list.
 */
function reader(): { file: string; scope: string[] } {
  const kubectl = resolveKubeBinary("kubectl");
  const oc = resolveKubeBinary("oc");
  const found = kubectl.path ?? oc.path;
  if (!found) {
    throw new ExecSessionError(
      "KubeBinaryMissing",
      kubectl.problem ?? "kubectl was not found on this machine.",
    );
  }
  const pinned = pinnedKubeconfig();
  return { file: found, scope: pinned ? [`--kubeconfig=${pinned}`] : [] };
}

/**
 * Every read goes through here, so a context name is checked against our own
 * kubeconfig before it becomes a flag - the same guarantee the driver gets, for
 * the same reason.
 */
async function args(
  context: string,
  namespace: string | null,
  signal: AbortSignal | undefined,
): Promise<{ file: string; prefix: string[] }> {
  const { file, scope } = reader();
  await assertKnownContext(context, signal ? { signal } : {});
  return {
    file,
    prefix: [
      ...scope,
      `--context=${context}`,
      ...(namespace === null ? [] : [`--namespace=${namespace}`]),
    ],
  };
}

interface ListOf<T> {
  readonly items?: ReadonlyArray<T>;
}

interface RawNamespace {
  readonly metadata?: { readonly name?: string; readonly creationTimestamp?: string };
  readonly status?: { readonly phase?: string };
}

export async function listNamespaces(
  context: string,
  options: { signal?: AbortSignal } = {},
): Promise<readonly KubeNamespaceInfo[]> {
  const { file, prefix } = await args(context, null, options.signal);
  const list = await get<ListOf<RawNamespace>>(
    file,
    [...prefix, "get", "namespaces", "-o", "json"],
    options.signal,
  );
  return (list.items ?? [])
    .filter((item) => typeof item.metadata?.name === "string")
    .map<KubeNamespaceInfo>((item) => ({
      name: item.metadata?.name ?? "",
      phase: item.status?.phase ?? "Unknown",
      createdAt: item.metadata?.creationTimestamp ?? null,
    }));
}

interface RawContainerStatus {
  readonly name?: string;
  readonly image?: string;
  readonly ready?: boolean;
  readonly restartCount?: number;
  readonly state?: Readonly<Record<string, { readonly reason?: string } | undefined>>;
}

interface RawPod {
  readonly metadata?: {
    readonly name?: string;
    readonly namespace?: string;
    readonly creationTimestamp?: string;
  };
  readonly spec?: {
    readonly nodeName?: string;
    readonly containers?: ReadonlyArray<{ readonly name?: string }>;
  };
  readonly status?: {
    readonly phase?: string;
    readonly podIP?: string;
    readonly containerStatuses?: ReadonlyArray<RawContainerStatus>;
    readonly initContainerStatuses?: ReadonlyArray<RawContainerStatus>;
  };
}

export async function listPods(
  scope: KubeScope,
  options: { signal?: AbortSignal } = {},
): Promise<readonly KubePodInfo[]> {
  const { file, prefix } = await args(scope.context, scope.namespace, options.signal);
  const list = await get<ListOf<RawPod>>(
    file,
    [...prefix, "get", "pods", "-o", "json"],
    options.signal,
  );
  return (list.items ?? [])
    .filter((item) => typeof item.metadata?.name === "string")
    .map((item) => toPod(item, scope.namespace));
}

function toPod(raw: RawPod, fallbackNamespace: string): KubePodInfo {
  const containers = [
    ...(raw.status?.initContainerStatuses ?? []).map((status) => toContainer(status, true)),
    ...(raw.status?.containerStatuses ?? []).map((status) => toContainer(status, false)),
  ];
  const app = containers.filter((container) => !container.init);
  const phase = raw.status?.phase ?? "Unknown";

  return {
    name: raw.metadata?.name ?? "",
    namespace: raw.metadata?.namespace ?? fallbackNamespace,
    phase,
    readyContainers: app.filter((container) => container.ready).length,
    // From the spec rather than from the statuses: a container that has not
    // been scheduled yet has no status at all, and "1/1" on a pod that is
    // really 1 of 3 is the one number here nobody would check twice.
    totalContainers: raw.spec?.containers?.length ?? app.length,
    restarts: app.reduce((total, container) => total + container.restarts, 0),
    nodeName: raw.spec?.nodeName ?? null,
    podIp: raw.status?.podIP ?? null,
    createdAt: raw.metadata?.creationTimestamp ?? null,
    containers,
    // Nothing can be exec'd into an init container, so a pod whose only ready
    // container is an init one still has no shell in it.
    execReady: phase === "Running" && app.some((container) => container.ready),
  };
}

function toContainer(raw: RawContainerStatus, init: boolean): KubeContainerInfo {
  const state = Object.keys(raw.state ?? {})[0] ?? "unknown";
  return {
    name: raw.name ?? "",
    image: raw.image ?? "",
    ready: raw.ready ?? false,
    restarts: raw.restartCount ?? 0,
    state,
    // `CrashLoopBackOff` and `ImagePullBackOff` are the two that explain an
    // absent shell, and both arrive as the reason of whichever state is set.
    reason: raw.state?.[state]?.reason ?? null,
    init,
  };
}

interface RawVirtualMachine {
  readonly metadata?: { readonly name?: string; readonly creationTimestamp?: string };
  readonly status?: { readonly printableStatus?: string };
}

interface RawVirtualMachineInstance {
  readonly metadata?: { readonly name?: string };
  readonly status?: {
    readonly phase?: string;
    readonly nodeName?: string;
    readonly conditions?: ReadonlyArray<{ readonly type?: string; readonly status?: string }>;
  };
}

/**
 * The machines, joined with the instances that are actually running.
 *
 * Two objects because KubeVirt keeps them apart: a `VirtualMachine` is the
 * definition and survives being stopped, while a `VirtualMachineInstance`
 * exists only while it runs and is the one that knows which node it landed on
 * and whether its guest agent is answering. `virtctl ssh` needs the second.
 */
export async function listVirtualMachines(
  scope: KubeScope,
  options: { signal?: AbortSignal } = {},
): Promise<readonly KubeVirtualMachineInfo[]> {
  const { file, prefix } = await args(scope.context, scope.namespace, options.signal);

  const machines = await get<ListOf<RawVirtualMachine>>(
    file,
    [...prefix, "get", "virtualmachines.kubevirt.io", "-o", "json"],
    options.signal,
  );
  const instances = await get<ListOf<RawVirtualMachineInstance>>(
    file,
    [...prefix, "get", "virtualmachineinstances.kubevirt.io", "-o", "json"],
    options.signal,
  );

  const running = new Map(
    (instances.items ?? []).map((item) => [item.metadata?.name ?? "", item] as const),
  );

  return (machines.items ?? [])
    .filter((item) => typeof item.metadata?.name === "string")
    .map<KubeVirtualMachineInfo>((item) => {
      const name = item.metadata?.name ?? "";
      const instance = running.get(name);
      const status = item.status?.printableStatus ?? "Unknown";
      const ready =
        instance?.status?.phase === "Running" &&
        (instance.status.conditions ?? []).some(
          (condition) => condition.type === "Ready" && condition.status === "True",
        );
      return {
        name,
        namespace: scope.namespace,
        status,
        running: instance !== undefined,
        ready,
        nodeName: instance?.status?.nodeName ?? null,
        createdAt: item.metadata?.creationTimestamp ?? null,
      };
    });
}

/**
 * Whether this is OpenShift, and whether KubeVirt is installed.
 *
 * Asked of the API server rather than guessed from the context name, because
 * both answers change what the UI offers rather than how it looks: `oc rsh` is
 * only worth naming where `oc` has something to talk to, and a Virtual machines
 * section on a cluster with no KubeVirt is a page that can only ever be empty.
 *
 * A cluster that cannot be reached answers "neither", which is the same shape
 * as a cluster that has neither: this is the question of what to show, not of
 * why a list is empty, and the list itself reports its own failure.
 */
export async function probeCapabilities(
  context: string,
  options: { signal?: AbortSignal } = {},
): Promise<KubeCapabilities> {
  try {
    const { file, prefix } = await args(context, null, options.signal);
    const names = await runKubeText(
      file,
      [...prefix, "api-resources", "-o", "name"],
      options.signal ? { signal: options.signal } : {},
    );
    const lines = names.split("\n").map((line) => line.trim());
    return {
      openShift: lines.some((line) => line.endsWith(".openshift.io")),
      kubeVirt: lines.some((line) => line === "virtualmachines.kubevirt.io"),
    };
  } catch {
    return { openShift: false, kubeVirt: false };
  }
}

/** One read, with a Kubernetes failure turned into a coded one. */
async function get<T>(file: string, argv: readonly string[], signal?: AbortSignal): Promise<T> {
  try {
    return await runKubeJson<T>(file, argv, signal ? { signal } : {});
  } catch (err) {
    throw translateKubeError(err);
  }
}
