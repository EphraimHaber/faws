/**
 * Flattened Kubernetes view models.
 *
 * Same contract as `s3.ts`: what the server fetchers produce and the tables
 * bind to, with the optionality already resolved. The Kubernetes API objects
 * these come from are deeply nested and mostly unread here - a pod's status
 * alone is four levels of arrays - so the flattening happens once, on the
 * server, rather than in every component that wants to know whether a shell
 * will work.
 *
 * Deliberately never the word "cluster": it means ECS everywhere else in this
 * app, and a column header reading "cluster" on a Kubernetes page would be the
 * one piece of vocabulary guaranteed to be misread.
 */

/** One entry from the kubeconfig's `contexts` list. */
export interface KubeContextInfo {
  readonly name: string;
  /** The cluster entry it names, which is how two contexts reveal one target. */
  readonly clusterName: string;
  readonly userName: string;
  /** The context's own default namespace, if it sets one. */
  readonly namespace: string | null;
  readonly server: string | null;
  /** True for the kubeconfig's `current-context`. */
  readonly current: boolean;
  /**
   * The command this context authenticates with, when it uses an `exec`
   * credential plugin. Stated rather than left implicit: `~/.ssh/config` gets
   * the same treatment here, because a config file that runs a program is
   * something the person should know about before we spawn anything.
   */
  readonly execPlugin: string | null;
}

export interface KubeNamespaceInfo {
  readonly name: string;
  /** `Active` or `Terminating`; a terminating namespace cannot take a new pod. */
  readonly phase: string;
  readonly createdAt: string | null;
}

export interface KubeContainerInfo {
  readonly name: string;
  readonly image: string;
  readonly ready: boolean;
  readonly restarts: number;
  /** `running`, `waiting` or `terminated`. */
  readonly state: string;
  /** `CrashLoopBackOff`, `ImagePullBackOff`, ... when there is one. */
  readonly reason: string | null;
  /** Init containers are listed, but nothing can be exec'd into one. */
  readonly init: boolean;
}

/**
 * A pod, with the columns that decide whether a shell will work.
 *
 * `execReady` follows the habit `ExecInstanceTarget.reachableBy` set: the
 * server has already joined phase and per-container readiness, so the UI does
 * not re-derive "can I press this" and get a different answer.
 */
export interface KubePodInfo {
  readonly name: string;
  readonly namespace: string;
  /** `Pending`, `Running`, `Succeeded`, `Failed`, `Unknown`. */
  readonly phase: string;
  readonly readyContainers: number;
  readonly totalContainers: number;
  readonly restarts: number;
  readonly nodeName: string | null;
  readonly podIp: string | null;
  readonly createdAt: string | null;
  readonly containers: ReadonlyArray<KubeContainerInfo>;
  /** Running, with at least one ready container that is not an init container. */
  readonly execReady: boolean;
}

/** A KubeVirt VirtualMachine, joined with its VirtualMachineInstance. */
export interface KubeVirtualMachineInfo {
  readonly name: string;
  readonly namespace: string;
  /** KubeVirt's own `printableStatus`: `Running`, `Stopped`, `Starting`, ... */
  readonly status: string;
  readonly running: boolean;
  /** The instance is up and its agent is reporting, so `virtctl ssh` can land. */
  readonly ready: boolean;
  readonly nodeName: string | null;
  readonly createdAt: string | null;
}

/** One external binary, as the diagnostics and degradation paths read it. */
export interface KubeBinaryInfo {
  readonly name: string;
  readonly found: boolean;
  /** Reported so "which kubectl is this" is answerable from the screen. */
  readonly path: string | null;
  readonly version: string | null;
  /** What to do about it when it is missing, in one actionable sentence. */
  readonly problem: string | null;
}

/**
 * Why a Kubernetes page is empty.
 *
 * Every failure here degrades to a page that says what is wrong and where we
 * looked, rather than an error: no `kubectl` and no kubeconfig are both
 * ordinary states for a machine that simply does not do Kubernetes.
 */
export interface KubeDiagnostics {
  readonly kubectl: KubeBinaryInfo;
  readonly oc: KubeBinaryInfo;
  readonly virtctl: KubeBinaryInfo;
  /** Every file the KUBECONFIG search covered, whether or not it exists. */
  readonly kubeconfigPaths: ReadonlyArray<string>;
  readonly kubeconfigFound: boolean;
  readonly currentContext: string | null;
  readonly contextNames: ReadonlyArray<string>;
  /** This is an OpenShift API server, so `oc rsh` is worth offering. */
  readonly openShift: boolean;
  /** KubeVirt is installed, so the virtual machines section has something in it. */
  readonly kubeVirt: boolean;
}
