/**
 * The server's answer to "is this provider on", and the procedures gated on it.
 *
 * Providers build their routers from `providerProcedure` in `@faws/kit/server`;
 * this module plugs the settings file in behind it, and adds the one gate that
 * belongs to the host: storage, whose owner is named by the connection.
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

/**
 * The storage procedures serve every provider that stores objects; the
 * connection says which. A call without one (an upload already under way,
 * named by its token) is gated in its body on the connection the upload was
 * opened against.
 */
export const storageProcedure = publicProcedure.use(
  middleware(async ({ getRawInput, next }) => {
    const provider = storageProviderOf(await getRawInput());
    if (provider) assertProviderEnabled(provider);
    return next();
  }),
);

/** The provider a storage call names, read before the input is validated. */
export function storageProviderOf(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const ref = (input as { ref?: unknown }).ref;
  if (typeof ref !== "object" || ref === null) return null;
  const provider = (ref as { provider?: unknown }).provider;
  return typeof provider === "string" && provider.length > 0 ? provider : null;
}
