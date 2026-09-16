import { AwsRequestError, ProfileNotFoundError, ReadOnlyModeError } from "@faws/contracts";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";

type ErrorCause =
  | {
      readonly kind: "AwsRequestError";
      readonly message: string;
      readonly code?: string;
      readonly service?: string;
    }
  | { readonly kind: "ProfileNotFoundError"; readonly message: string; readonly profile?: string }
  | { readonly kind: "ReadOnlyModeError"; readonly message: string };

const t = initTRPC.create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const original = error.cause;
    let cause: ErrorCause | undefined;
    if (original instanceof AwsRequestError) {
      cause = {
        kind: "AwsRequestError",
        message: original.message,
        ...(original.code ? { code: original.code } : {}),
        ...(original.service ? { service: original.service } : {}),
      };
    } else if (original instanceof ProfileNotFoundError) {
      cause = {
        kind: "ProfileNotFoundError",
        message: original.message,
        ...(original.profile ? { profile: original.profile } : {}),
      };
    } else if (original instanceof ReadOnlyModeError) {
      cause = { kind: "ReadOnlyModeError", message: original.message };
    }
    return { ...shape, data: { ...shape.data, cause } };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

/** Every ECS call is scoped to the profile/region the UI currently shows. */
export const scopeInput = z.object({
  profile: z.string(),
  region: z.string().min(1),
});

export function toTrpcError(err: unknown): TRPCError {
  if (err instanceof ProfileNotFoundError) {
    return new TRPCError({ code: "NOT_FOUND", message: err.message, cause: err });
  }
  if (err instanceof ReadOnlyModeError) {
    return new TRPCError({ code: "FORBIDDEN", message: err.message, cause: err });
  }
  if (err instanceof AwsRequestError) {
    return new TRPCError({ code: "BAD_REQUEST", message: err.message, cause: err });
  }
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: err instanceof Error ? err.message : "Unknown error",
    cause: err instanceof Error ? err : undefined,
  });
}

/** Wraps a fetcher call so every router body reports errors identically. */
export async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toTrpcError(err);
  }
}
