import {
  type TrustEntry,
  trustAddSchema,
  trustImportSchema,
  trustTargetSchema,
} from "@faws/contracts";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { guard, publicProcedure, router } from "../../trpc/index.ts";
import { settingsStore } from "../settings/settings.instance.ts";
import { applyTrust, entryFor, inspectChain, parsePemBundle } from "./trust.ts";

function current() {
  return settingsStore().get().settings.trust;
}

function save(entries: TrustEntry[], useSystemStore = current().useSystemStore) {
  const trust = { useSystemStore, entries };
  applyTrust(trust);
  return settingsStore().setTrust(trust).settings.trust;
}

function merge(
  existing: ReadonlyArray<TrustEntry>,
  added: ReadonlyArray<TrustEntry>,
): TrustEntry[] {
  const known = new Set(existing.map((entry) => entry.fingerprintSha256));
  return [...existing, ...added.filter((entry) => !known.has(entry.fingerprintSha256))];
}

/**
 * The certificates this app trusts. Trusting is local to this machine, so
 * every mutation is a `local` effect: read-only mode does not stand in the
 * way of deciding what to trust, and nothing outside the app changes.
 */
export const trustRouter = router({
  /** What a host presents, and whether trusting part of it would help. */
  inspect: publicProcedure
    .input(trustTargetSchema)
    .query(({ input }) =>
      guard(async () => (await inspectChain(input.host, input.port, current().entries)).summary),
    ),

  /**
   * Trusts the chosen certificates from what the host presents right now.
   * Fetched again here rather than taken from the request, so what is trusted
   * is exactly what that host serves, not whatever a caller sends.
   */
  add: publicProcedure
    .meta({ effect: "local" })
    .input(trustAddSchema)
    .mutation(({ input }) =>
      guard(async () => {
        const { certificates } = await inspectChain(input.host, input.port, current().entries);
        const wanted = new Set(input.fingerprints.map((value) => value.toUpperCase()));
        const from = `${input.host}:${input.port}`;
        const added = certificates
          .filter((cert) => wanted.has(cert.fingerprint256.toUpperCase()))
          .map((cert) => entryFor(cert, from))
          .filter((entry): entry is TrustEntry => entry !== null);
        if (added.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "None of those certificates can be trusted on their own: pick a CA in the chain, or a self-signed certificate.",
          });
        }
        return save(merge(current().entries, added));
      }),
    ),

  import: publicProcedure
    .meta({ effect: "local" })
    .input(trustImportSchema)
    .mutation(({ input }) =>
      guard(async () => {
        let certificates;
        try {
          certificates = parsePemBundle(input.pem);
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error instanceof Error ? error.message : String(error),
          });
        }
        const added = certificates
          .map((cert) => entryFor(cert, "imported", certificates.length === 1 ? input.label : ""))
          .filter((entry): entry is TrustEntry => entry !== null);
        if (added.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That is a server certificate signed by a CA; import the CA instead.",
          });
        }
        return save(merge(current().entries, added));
      }),
    ),

  remove: publicProcedure
    .meta({ effect: "local" })
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ input }) => save(current().entries.filter((entry) => entry.id !== input.id))),

  setUseSystemStore: publicProcedure
    .meta({ effect: "local" })
    .input(z.object({ enabled: z.boolean() }))
    .mutation(({ input }) => save([...current().entries], input.enabled)),
});
