/**
 * Procedures that belong to a provider, refused while it is switched off.
 *
 * Checked on every call rather than by leaving routers unmounted, so turning a
 * provider back on in Settings takes effect without a restart, and a stale tab
 * or a forgotten poll gets a clear "switched off" instead of reading
 * `~/.aws` or spawning `kubectl` behind the user's back.
 */
import { manifestFor, type ProviderId } from "@faws/contracts";
import { ProviderDisabledError } from "@faws/kit";

import { settingsStore } from "../api/settings/settings.instance.ts";
import { middleware, publicProcedure, toTrpcError } from "./index.ts";

export function isProviderEnabled(id: ProviderId): boolean {
  return settingsStore().get().settings.providers[id].enabled;
}

function assertEnabled(id: ProviderId): void {
  if (!isProviderEnabled(id)) {
    throw toTrpcError(new ProviderDisabledError(id, manifestFor(id).label));
  }
}

export function providerProcedure(id: ProviderId) {
  return publicProcedure.use(
    middleware(({ next }) => {
      assertEnabled(id);
      return next();
    }),
  );
}

export const awsProcedure = providerProcedure("aws");
export const kubernetesProcedure = providerProcedure("kubernetes");
export const s3EndpointsProcedure = providerProcedure("s3");

/**
 * The S3 procedures serve AWS's S3 and saved S3-compatible endpoints alike;
 * the scope says which. A `connectionId` is an endpoint, a profile without one
 * is AWS, and a call carrying neither (an upload already under way, named by
 * its token) was checked when it started.
 */
export const storageProcedure = publicProcedure.use(
  middleware(async ({ getRawInput, next }) => {
    const owner = storageOwner(await getRawInput());
    if (owner) assertEnabled(owner);
    return next();
  }),
);

export function storageOwner(input: unknown): ProviderId | null {
  if (typeof input !== "object" || input === null) return null;
  const { connectionId, profile } = input as { connectionId?: unknown; profile?: unknown };
  if (typeof connectionId === "string" && connectionId.length > 0) return "s3";
  if (typeof profile === "string") return "aws";
  return null;
}
