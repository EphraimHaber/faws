/**
 * Kubernetes as questions, rather than as a stream.
 *
 * Every procedure here takes a context and a namespace, and none of them takes
 * a profile or a region. That is not an omission for later: query keys are made
 * from the input, so kube panes are keyed by kube scope and switching AWS
 * profile leaves them alone. Adding `{profile, region}` "for consistency" would
 * blank every pod list the next time someone changed account, for a pair the
 * cluster has never heard of.
 *
 * `diagnostics` exists for the same reason `exec.diagnostics` does: a machine
 * with no `kubectl`, or no kubeconfig, is an ordinary machine, and the page
 * should be able to say so before anyone presses anything. It answers with
 * facts and never throws, so there is always something to render.
 */
import { kubeContextSchema, kubeLabelSchema } from "@faws/contracts";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, router } from "../../trpc/index.ts";
import { isExecSessionError } from "../exec/errors.ts";
import { kubeDiagnostics } from "./binaries.ts";
import { listKubeContexts } from "./kubeconfig.ts";
import { listNamespaces, listPods, listVirtualMachines, probeCapabilities } from "./resources.ts";

/** A context alone: namespaces and capabilities are not namespaced. */
const contextInput = z.object({ context: kubeContextSchema });

/** The pair every list of workloads is scoped by. */
const scopeInput = contextInput.extend({ namespace: kubeLabelSchema });

export const kubeRouter = router({
  diagnostics: publicProcedure
    .input(z.object({ context: kubeContextSchema.optional() }).default({}))
    .query(({ input, signal }) =>
      kubeDiagnostics({
        ...(input.context ? { context: input.context } : {}),
        ...(signal ? { signal } : {}),
      }),
    ),

  contexts: publicProcedure.query(({ signal }) =>
    kube(() => listKubeContexts(signal ? { signal } : {})),
  ),

  capabilities: publicProcedure
    .input(contextInput)
    .query(({ input, signal }) => probeCapabilities(input.context, signal ? { signal } : {})),

  namespaces: publicProcedure
    .input(contextInput)
    .query(({ input, signal }) =>
      kube(() => listNamespaces(input.context, signal ? { signal } : {})),
    ),

  pods: publicProcedure
    .input(scopeInput)
    .query(({ input, signal }) => kube(() => listPods(input, signal ? { signal } : {}))),

  virtualMachines: publicProcedure
    .input(scopeInput)
    .query(({ input, signal }) => kube(() => listVirtualMachines(input, signal ? { signal } : {}))),
});

/**
 * Keeps the coded message, drops the code.
 *
 * `guard()` is for AWS SDK faults and would report every one of these as an
 * internal error. The code itself is not carried to the client here: unlike a
 * session, a failed list has one remediation and it is the sentence the error
 * already holds, which the page prints as it stands.
 */
async function kube<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isExecSessionError(err)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: err.message, cause: err });
    }
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: err instanceof Error ? err.message : "Unknown error",
      cause: err instanceof Error ? err : undefined,
    });
  }
}
