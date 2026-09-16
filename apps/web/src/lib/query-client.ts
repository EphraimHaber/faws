import { QueryClient } from "@tanstack/react-query";

/**
 * tRPC codes that mean "this will never succeed": a bad profile, a region the
 * account can't reach, an unsupported call. Retrying them just multiplies the
 * error toast while the user is mid-typing in the region picker.
 */
const NON_RETRYABLE = new Set([
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "NOT_IMPLEMENTED",
  "METHOD_NOT_SUPPORTED",
  "CONFLICT",
]);

function isNonRetryable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { data?: { code?: unknown } }).data?.code;
  return typeof code === "string" && NON_RETRYABLE.has(code);
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: (failureCount, error) => !isNonRetryable(error) && failureCount < 2,
    },
  },
});
