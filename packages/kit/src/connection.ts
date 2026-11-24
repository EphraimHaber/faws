/**
 * Where a capability call is pointed.
 *
 * A provider names its own connections: AWS encodes a profile and region in
 * `id`, a saved endpoint uses its record id. Generic code passes the pair
 * through without reading `id`, and the host picks the provider's
 * implementation by `provider` alone.
 */
import { z } from "zod";

export interface ConnectionRef {
  readonly provider: string;
  readonly id: string;
}

export const connectionRefSchema = z.object({
  provider: z.string().min(1).max(64),
  id: z.string().min(1).max(512),
});

/**
 * One string per connection, for query keys and map keys.
 *
 * NUL cannot occur in a provider id or in anything a provider puts in `id`, so
 * two different refs never share a key.
 */
export function connectionKey(ref: ConnectionRef): string {
  return `${ref.provider}\x00${ref.id}`;
}

export function sameConnection(a: ConnectionRef, b: ConnectionRef): boolean {
  return a.provider === b.provider && a.id === b.id;
}
