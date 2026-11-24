/**
 * The tRPC instance every router in the app is built from.
 *
 * Two policies live here so no router can forget them:
 *
 * - **Errors.** A `DomainError` thrown anywhere in a procedure reaches the wire
 *   with the transport status it declares and its `toCause()` in
 *   `error.data.cause`. Anything else is an internal error.
 * - **Effects.** A procedure declares what it does to the world with
 *   `.meta({ effect })`, and the write-mode switches are checked before its
 *   body runs. Every mutation must declare one; `undeclaredMutations` is what
 *   the server's test uses to hold that line.
 */
import { initTRPC, TRPCError, type AnyRouter } from "@trpc/server";
import superjson from "superjson";

import { DomainError, type ErrorCause } from "../errors.ts";
import { assertDestructive, assertMutable } from "../guard.ts";

/**
 * What a procedure does, from the point of view of someone who did not mean to.
 *
 * - `read` changes nothing anywhere.
 * - `local` changes only this app's own state: settings, saved connections,
 *   recordings on disk. Read-only mode does not apply to it.
 * - `write` changes something outside the app; needs read-only off.
 * - `destructive` destroys or overwrites something outside the app; needs the
 *   deletion switch armed as well.
 *
 * Input-dependent escalation (an upload that overwrites) is the engine's to
 * check; the declared effect is the least the procedure can do.
 */
export type Effect = "read" | "local" | "write" | "destructive";

export interface ProcedureMeta {
  readonly effect?: Effect;
  /** Names the operation in a refusal, e.g. `s3:DeleteObjects`; defaults to the procedure path. */
  readonly operation?: string;
}

export interface ServerErrorData {
  readonly cause: ErrorCause | undefined;
}

const t = initTRPC.meta<ProcedureMeta>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const cause = error.cause instanceof DomainError ? error.cause.toCause() : undefined;
    return { ...shape, data: { ...shape.data, cause } satisfies ServerErrorData };
  },
});

export function toTrpcError(err: unknown): TRPCError {
  if (err instanceof TRPCError) return err;
  if (err instanceof DomainError) {
    return new TRPCError({ code: err.status, message: err.message, cause: err });
  }
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: err instanceof Error ? err.message : "Unknown error",
    cause: err instanceof Error ? err : undefined,
  });
}

/**
 * Classifies a `DomainError` that escaped a procedure body.
 *
 * tRPC wraps anything thrown that is not a `TRPCError` as an internal error;
 * this unwraps it again so a body can simply throw.
 */
const classifyErrors = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok && result.error.code === "INTERNAL_SERVER_ERROR") {
    const cause = result.error.cause;
    if (cause instanceof DomainError) return { ...result, error: toTrpcError(cause) };
  }
  return result;
});

const enforceEffect = t.middleware(({ meta, path, next }) => {
  const operation = meta?.operation ?? path;
  try {
    if (meta?.effect === "write") assertMutable(operation);
    else if (meta?.effect === "destructive") assertDestructive(operation);
  } catch (err) {
    throw toTrpcError(err);
  }
  return next();
});

export const router = t.router;
export const middleware = t.middleware;
export const publicProcedure = t.procedure.use(classifyErrors).use(enforceEffect);

/** Wraps an engine call so a body reports errors identically whether or not it throws a TRPCError. */
export async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toTrpcError(err);
  }
}

/** Paths of mutations that declare no `effect`; empty is the only acceptable answer. */
export function undeclaredMutations(appRouter: AnyRouter): string[] {
  // oxlint-disable-next-line no-underscore-dangle
  const procedures = appRouter._def.procedures as Record<
    string,
    { _def: { type: string; meta?: ProcedureMeta } }
  >;
  return Object.entries(procedures)
    .filter(([, procedure]) => {
      // tRPC exposes a procedure's type and meta only through `_def`.
      // oxlint-disable-next-line no-underscore-dangle
      const { type, meta } = procedure._def;
      return type === "mutation" && !meta?.effect;
    })
    .map(([path]) => path)
    .toSorted();
}
