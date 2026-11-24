/**
 * How a provider's tRPC router joins the host's `AppRouter`.
 *
 * A provider's server module exports one `ProviderServer`: its router paired
 * with its manifest id. The host mounts them with `mountProviders`, which keys
 * each router by that id, so the client path (`trpc.<id>.…`) is always the
 * provider id and cannot drift from it.
 */
import type { AnyRouter } from "@trpc/server";

export interface ProviderServer<Id extends string = string, R extends AnyRouter = AnyRouter> {
  /** The provider's manifest id; the router is mounted under it. */
  readonly id: Id;
  readonly router: R;
}

/** Keeps the id's literal type, so the mounted key is inferred from it. */
export function defineProviderServer<const Id extends string, R extends AnyRouter>(
  server: ProviderServer<Id, R>,
): ProviderServer<Id, R> {
  return server;
}

/** `{ [id]: router }` for each provider in the list. */
export type MountedProviders<S extends ReadonlyArray<ProviderServer>> = {
  [P in S[number] as P["id"]]: P["router"];
};

/** Spread the result into the host's `router({...})`. */
export function mountProviders<const S extends ReadonlyArray<ProviderServer>>(
  servers: S,
): MountedProviders<S> {
  const mounted: Record<string, AnyRouter> = {};
  for (const server of servers) {
    if (server.id in mounted) throw new Error(`Provider "${server.id}" is mounted twice.`);
    mounted[server.id] = server.router;
  }
  return mounted as MountedProviders<S>;
}
