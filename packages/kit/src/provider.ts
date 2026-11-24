/**
 * How a provider describes itself.
 *
 * A provider is something faws connects to and the user can switch on or off:
 * AWS, a Kubernetes cluster, S3-compatible storage on their own network. Its
 * manifest is plain data, importable from the Electron main process, the
 * server and the renderer alike, and everything that lists providers - the
 * sidebar, the command palette, the breadcrumb, the app menu, the settings
 * page - is derived from it rather than kept in step with it by hand.
 */

/**
 * Cross-provider abilities. Generic UI is written against these, so a bucket
 * browser or a log viewer is built once and offered for every provider that
 * declares the capability.
 */
export const CAPABILITIES = [
  "objectStorage",
  "workloads",
  "logs",
  "metrics",
  "terminal",
  "vms",
  "identity",
] as const;
export type CapabilityId = (typeof CAPABILITIES)[number];

/**
 * Icons are named rather than imported, so a manifest stays free of React.
 * The renderer maps every name to a component in a table typed against this
 * list, which turns a missing icon into a compile error.
 */
export const ICON_NAMES = [
  "boxes",
  "cloud",
  "container",
  "database",
  "file-json",
  "film",
  "function-square",
  "gauge",
  "globe",
  "hard-drive",
  "inbox",
  "key-round",
  "layers",
  "monitor",
  "network",
  "plug",
  "rocket",
  "scroll-text",
  "server",
  "ship",
  "terminal-square",
  "warehouse",
  "waypoints",
] as const;
export type IconName = (typeof ICON_NAMES)[number];

/**
 * A page within a service.
 *
 * `requires` reads the provider's runtime facts - what the connection in view
 * turned out to have - so a section that could only ever be empty there (KubeVirt
 * machines on a cluster without KubeVirt) is left out rather than offered.
 */
export interface SectionManifest<Runtime extends object> {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  /** Route for this section; absent while planned. */
  readonly to?: string;
  readonly requires?: (runtime: Runtime) => boolean;
}

export interface ServiceManifest<Runtime extends object> {
  readonly id: string;
  /** Short name, as the provider writes it. */
  readonly label: string;
  readonly description: string;
  readonly icon: IconName;
  /** Planned services are listed so the gap is known, never linked. */
  readonly status: "available" | "planned";
  /** Root route; every section lives under it. */
  readonly basePath: string;
  readonly sections: ReadonlyArray<SectionManifest<Runtime>>;
}

export interface ProviderManifest<Id extends string, Runtime extends object> {
  readonly id: Id;
  readonly label: string;
  readonly description: string;
  readonly icon: IconName;
  /** Position among providers wherever they are listed; lower comes first. */
  readonly order: number;
  /** Whether a fresh install starts with it on, before detection says otherwise. */
  readonly defaultEnabled: boolean;
  readonly capabilities: ReadonlyArray<CapabilityId>;
  /** What is assumed about a connection until it has been asked. */
  readonly runtimeDefaults: Runtime;
  readonly services: ReadonlyArray<ServiceManifest<Runtime>>;
}

/**
 * Declares a provider. The `const` type parameter keeps the id a literal, so
 * the set of provider ids - and everything keyed by them - is inferred from
 * the manifests rather than written out a second time.
 */
export function defineProvider<const Id extends string, Runtime extends object>(
  manifest: ProviderManifest<Id, Runtime>,
): ProviderManifest<Id, Runtime> {
  return manifest;
}

// `any` for the runtime because `requires` takes it as a parameter: a list
// holding several providers cannot name one runtime type all of them accept.
export type AnyProviderManifest = ProviderManifest<string, any>;

export type ProviderIdOf<P extends ReadonlyArray<AnyProviderManifest>> = P[number]["id"];

export type RuntimeOf<M extends AnyProviderManifest> = M["runtimeDefaults"];
