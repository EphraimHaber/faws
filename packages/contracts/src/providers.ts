/**
 * The providers this build knows, and the settings each one carries.
 *
 * Contracts holds the list because the settings file is shaped by it and both
 * the server and the renderer parse that file. The manifests themselves are
 * plain data, so importing them here costs nothing at runtime.
 */
import type { ProviderIdOf } from "@faws/kit";
import { awsManifest } from "@faws/provider-aws/manifest";
import { kubernetesManifest } from "@faws/provider-kubernetes/manifest";
import { s3compatManifest } from "@faws/provider-s3compat/manifest";

export const PROVIDER_MANIFESTS = [awsManifest, kubernetesManifest, s3compatManifest] as const;

export type ProviderId = ProviderIdOf<typeof PROVIDER_MANIFESTS>;

export const PROVIDER_IDS: ReadonlyArray<ProviderId> = PROVIDER_MANIFESTS.map(
  (manifest) => manifest.id,
);

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as ReadonlyArray<string>).includes(value);
}

export type ProviderManifestOf<Id extends ProviderId> = Extract<
  (typeof PROVIDER_MANIFESTS)[number],
  { id: Id }
>;

export function manifestFor<Id extends ProviderId>(id: Id): ProviderManifestOf<Id> {
  return PROVIDER_MANIFESTS.find((manifest) => manifest.id === id) as ProviderManifestOf<Id>;
}
