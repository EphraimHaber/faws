import type { AnyProviderManifest, ProviderIdOf, ServiceManifest } from "@faws/kit";
import { awsManifest } from "@faws/provider-aws/manifest";
import { kubernetesManifest } from "@faws/provider-kubernetes/manifest";
import { s3compatManifest } from "@faws/provider-s3compat/manifest";
import type { LucideIcon } from "lucide-react";

import { ICONS } from "~/providers/icons";

/**
 * Everything the app connects to, and the services each one offers.
 *
 * This is the seam the shell is organised around: the sidebar, the command
 * palette, the breadcrumb trail and the front door all read it. It is derived
 * from the provider manifests, so adding a service means adding it to its
 * provider's manifest and a feature folder - not touching the shell.
 */
const MANIFESTS = [awsManifest, kubernetesManifest, s3compatManifest] as const;

export type ProviderId = ProviderIdOf<typeof MANIFESTS>;

/** Who a service belongs to: a provider, or the app itself. */
export type ServiceOwner = ProviderId | "host";

export interface ServiceSection {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** Route for this section; absent while planned. */
  readonly to?: string;
  readonly requires?: (runtime: any) => boolean;
}

export interface ServiceDefinition {
  readonly id: string;
  readonly owner: ServiceOwner;
  /** Short name, as its provider writes it. */
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly status: "available" | "planned";
  /** Root route; every section lives under it. */
  readonly basePath: string;
  readonly sections: ReadonlyArray<ServiceSection>;
}

export interface ProviderDefinition {
  readonly id: ProviderId;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly defaultEnabled: boolean;
  readonly runtimeDefaults: object;
  readonly services: ReadonlyArray<ServiceDefinition>;
}

function toService(owner: ServiceOwner, service: ServiceManifest<any>): ServiceDefinition {
  return {
    ...service,
    owner,
    icon: ICONS[service.icon],
    sections: service.sections.map((section) => ({ ...section, icon: ICONS[section.icon] })),
  };
}

function toProvider(manifest: AnyProviderManifest): ProviderDefinition {
  return {
    id: manifest.id as ProviderId,
    label: manifest.label,
    description: manifest.description,
    icon: ICONS[manifest.icon],
    defaultEnabled: manifest.defaultEnabled,
    runtimeDefaults: manifest.runtimeDefaults,
    services: manifest.services.map((service) => toService(manifest.id as ProviderId, service)),
  };
}

/** Providers in the order they are listed everywhere. */
export const PROVIDERS: ReadonlyArray<ProviderDefinition> = MANIFESTS.toSorted(
  (a, b) => a.order - b.order,
).map(toProvider);

/**
 * Services the app offers whatever it is connected to.
 *
 * Sessions is here rather than under a provider because it is every open
 * shell - ECS, SSM, SSH and Kubernetes - in one list, and SSH belongs to no
 * provider at all.
 */
export const HOST_SERVICES: ReadonlyArray<ServiceDefinition> = [
  toService("host", {
    id: "sessions",
    label: "Sessions",
    description: "Every open shell - ECS, SSM, SSH and Kubernetes - in one list",
    icon: "terminal-square",
    status: "available",
    basePath: "/sessions",
    sections: [{ id: "recordings", label: "Recordings", icon: "film", to: "/sessions/recordings" }],
  }),
];

/**
 * Every service, providers' first and the app's own after them.
 *
 * Typed as non-empty so callers that need "some service" - a default
 * selection, a fallback for an unrecognised id - can take the first entry
 * without a runtime guard for a list that is never empty.
 */
export const SERVICES = [
  ...PROVIDERS.flatMap((provider) => provider.services),
  ...HOST_SERVICES,
] as unknown as readonly [ServiceDefinition, ...ServiceDefinition[]];

/**
 * What each provider's connection in view turned out to have, by provider.
 * A provider missing from it is assumed to have its manifest's defaults.
 */
export type NavRuntime = Partial<Readonly<Record<ProviderId, object>>>;

/** The sections to offer, once what the connection in view has is known. */
export function visibleSections(
  service: ServiceDefinition,
  runtime: NavRuntime,
): ReadonlyArray<ServiceSection> {
  const facts =
    service.owner === "host"
      ? {}
      : (runtime[service.owner] ?? findProvider(service.owner)?.runtimeDefaults ?? {});
  return service.sections.filter((section) => !section.requires || section.requires(facts));
}

export function findProvider(id: string): ProviderDefinition | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}

export function findService(id: string): ServiceDefinition | undefined {
  return SERVICES.find((service) => service.id === id);
}

/** What a caller lands on when it has no id of its own to offer. */
export const DEFAULT_SERVICE: ServiceDefinition =
  SERVICES.find((service) => service.status === "available") ?? SERVICES[0];

/**
 * Turns whatever a URL carries into a service that exists.
 *
 * Shared and bookmarked links outlive the registry, so an id that was never
 * valid - or stopped being - resolves to the default instead of leaving the
 * caller with nothing to render.
 */
export function resolveService(value: unknown): ServiceDefinition {
  return (typeof value === "string" ? findService(value) : undefined) ?? DEFAULT_SERVICE;
}

/**
 * The service a pathname belongs to, for the sidebar's active state. The
 * longest matching base path wins, so `/s3/connections` is the endpoints
 * service rather than S3.
 */
export function serviceForPath(pathname: string): ServiceDefinition | undefined {
  let best: ServiceDefinition | undefined;
  for (const service of SERVICES) {
    const matches = pathname === service.basePath || pathname.startsWith(`${service.basePath}/`);
    if (matches && (!best || service.basePath.length > best.basePath.length)) best = service;
  }
  return best;
}
