/**
 * In dev the Vite server injects VITE_TRPC_URL pointing at the standalone
 * server; in the packaged desktop app the SPA is served by that same server,
 * so same-origin is correct.
 */
export function resolveTrpcUrl(): string {
  const explicit = (import.meta.env.VITE_TRPC_URL ?? "").trim();
  if (explicit.length > 0) return explicit;
  if (typeof window === "undefined") return "/trpc";
  const proto = window.location.protocol === "https:" ? "https:" : "http:";
  return `${proto}//${window.location.host}/trpc`;
}

export function resolveServerOrigin(): string {
  try {
    return new URL(resolveTrpcUrl()).origin;
  } catch {
    return window.location.origin;
  }
}
