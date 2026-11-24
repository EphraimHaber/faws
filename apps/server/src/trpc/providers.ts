/**
 * The server's answer to "is this provider on", and the procedures gated on it.
 *
 * Providers build their routers from `providerProcedure` in `@faws/kit/server`;
 * this module plugs the settings file in behind it, and adds the one gate that
 * belongs to the host: storage, whose owner depends on the scope.
 */
import { isProviderId, manifestFor, type ProviderId } from "@faws/contracts";
import { assertProviderEnabled, providerProcedure, setProviderGate } from "@faws/kit/server";

import { settingsStore } from "../api/settings/settings.instance.ts";
import { middleware, publicProcedure } from "./index.ts";

export function isProviderEnabled(id: ProviderId): boolean {
  return settingsStore().get().settings.providers[id].enabled;
}

setProviderGate({
  isEnabled: (id) => !isProviderId(id) || isProviderEnabled(id),
  label: (id) => (isProviderId(id) ? manifestFor(id).label : id),
});

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
    if (owner) assertProviderEnabled(owner);
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
