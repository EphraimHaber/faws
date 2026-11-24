/**
 * Procedures that belong to a provider, refused while it is switched off.
 *
 * Checked on every call rather than by leaving routers unmounted, so turning a
 * provider back on takes effect without a restart. The server says what "on"
 * means with `setProviderGate` - it owns the settings - and a provider package
 * builds its router from `providerProcedure(id)` without knowing where that
 * answer comes from.
 */
import { ProviderDisabledError } from "../errors.ts";
import { middleware, publicProcedure, toTrpcError } from "./trpc.ts";

interface Gate {
  isEnabled(id: string): boolean;
  label(id: string): string;
}

/** Until the server says otherwise, everything is on: tests and scripts need no setup. */
let gate: Gate = { isEnabled: () => true, label: (id) => id };

export function setProviderGate(next: Gate): void {
  gate = next;
}

export function assertProviderEnabled(id: string): void {
  if (!gate.isEnabled(id)) throw toTrpcError(new ProviderDisabledError(id, gate.label(id)));
}

export function providerProcedure(id: string) {
  return publicProcedure.use(
    middleware(({ next }) => {
      assertProviderEnabled(id);
      return next();
    }),
  );
}
