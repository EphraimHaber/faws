/**
 * The note a window leaves about which terminal tabs were open.
 *
 * Its own module so it can be tested without the store, because the failure it
 * guards against is silent. The list is parsed under a `catch([])`, so one
 * entry the schema does not recognise does not cost that entry - it costs every
 * remembered tab, and the dock comes back empty with nothing said. A kind added
 * to the handshake union and not added here would do exactly that, which is why
 * `kind` is `execKindSchema` from the contract rather than an enum written out
 * again.
 *
 * Only the id and what the tab was connected to. Never a socket, never a key,
 * never any of the scrollback.
 */
import { execKindSchema } from "@faws/contracts";
import { z } from "zod";

export const OPEN_TABS_KEY = "faws:terminal:open";

export const openTabSchema = z.array(
  z.object({
    id: z.string().min(1),
    target: z.unknown(),
    title: z.string(),
    subtitle: z.string(),
    kind: execKindSchema,
  }),
);

export type RememberedTab = z.infer<typeof openTabSchema>[number];

/** Parses what `localStorage` held, or answers with nothing remembered. */
export const storedOpenTabs = z
  .string()
  .transform((raw) => openTabSchema.parse(JSON.parse(raw)))
  .catch([]);
