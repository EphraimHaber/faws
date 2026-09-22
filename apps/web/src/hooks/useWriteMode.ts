import type { WriteMode, WriteNeed } from "@faws/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { getSocket } from "~/lib/socket";
import { trpc } from "~/lib/trpc";

export type { WriteNeed };

/** How far this session is allowed to go. */
export type WriteLevel = "read" | "write" | "destructive";

export interface WriteModeState extends WriteMode {
  readonly level: WriteLevel;
  /** False until the server has answered once. */
  readonly ready: boolean;
  /**
   * Why an operation of this kind is refused, or null if it is allowed.
   *
   * A string rather than a boolean because the two refusals are different and
   * the difference is the actionable part: "this session cannot write at all"
   * and "it can write, but this destroys something" have different next steps.
   */
  reasonFor(need: WriteNeed): string | null;
  setReadOnly(next: boolean): void;
  setDestructive(next: boolean): void;
}

/**
 * The two switches, as the UI sees them.
 *
 * They live in the server process rather than in settings, so this is a query
 * rather than a store. What it adds over calling `trpc.aws.writeMode` directly
 * is the two things every caller would otherwise repeat: the reason strings,
 * written once here so a disabled button and the Settings page cannot describe
 * the same state differently, and the socket subscription that keeps windows
 * agreeing.
 *
 * Until the server has answered, `reasonFor` refuses. The default posture is
 * read-only and the honest thing to do while we do not know is to assume it,
 * rather than to offer a button that is about to fail.
 */
export function useWriteMode(): WriteModeState {
  const queryClient = useQueryClient();
  const mode = useQuery(trpc.aws.writeMode.queryOptions());

  // Another window flipping a switch has to reach this one. Without it a
  // window keeps whatever it last queried, which for a safety switch is the
  // one behaviour that is never acceptable.
  React.useEffect(() => {
    const socket = getSocket();
    const handler = () => {
      void queryClient.invalidateQueries({ queryKey: trpc.aws.writeMode.queryKey() });
    };
    socket.on("write-mode:changed", handler);
    return () => {
      socket.off("write-mode:changed", handler);
    };
  }, [queryClient]);

  const setMode = useMutation(
    trpc.aws.setWriteMode.mutationOptions({
      // Everything the UI shows about what may be changed is downstream of
      // this, including lists whose rows carry their own actions.
      onSuccess: () => void queryClient.invalidateQueries(),
    }),
  );

  const readOnly = mode.data?.readOnly ?? true;
  const destructive = mode.data?.destructive ?? false;
  const ready = mode.data !== undefined;

  return React.useMemo<WriteModeState>(
    () => ({
      readOnly,
      destructive,
      ready,
      level: readOnly ? "read" : destructive ? "destructive" : "write",
      reasonFor: (need) => {
        if (!ready) return "Still checking what this session is allowed to do.";
        if (readOnly) return "faws is in read-only mode.";
        if (need === "destructive" && !destructive) {
          return "Deletion is not armed for this session.";
        }
        return null;
      },
      setReadOnly: (next) => setMode.mutate({ readOnly: next }),
      setDestructive: (next) => setMode.mutate({ destructive: next }),
    }),
    [readOnly, destructive, ready, setMode],
  );
}
