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
import {
  kubeBrowserLoginIdSchema,
  kubeBrowserLoginStartSchema,
  kubeContextSchema,
  kubeLabelSchema,
  kubeLoginInputSchema,
  kubeReloginInputSchema,
  kubeServerSchema,
} from "@faws/contracts";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { DomainError } from "@faws/kit";
import { isExecSessionError, providerProcedure, router, toTrpcError } from "@faws/kit/server";

import { kubeDiagnostics } from "./diagnostics.ts";
import { listKubeContexts } from "./kubeconfig.ts";
import {
  cancelBrowserLogin,
  completeBrowserLogin,
  login,
  loginStatuses,
  logout,
  probeCluster,
  relogin,
  startBrowserLogin,
} from "./login.ts";
import { listNamespaces, listPods, listVirtualMachines, probeCapabilities } from "./resources.ts";

/** A context alone: namespaces and capabilities are not namespaced. */
const contextInput = z.object({ context: kubeContextSchema });

/** The pair every list of workloads is scoped by. */
const scopeInput = contextInput.extend({ namespace: kubeLabelSchema });

/** Every procedure here answers only while Kubernetes is switched on. */
const kubernetesProcedure = providerProcedure("kubernetes");

export const kubeRouter = router({
  diagnostics: kubernetesProcedure
    .input(z.object({ context: kubeContextSchema.optional() }).default({}))
    .query(({ input, signal }) =>
      kubeDiagnostics({
        ...(input.context ? { context: input.context } : {}),
        ...(signal ? { signal } : {}),
      }),
    ),

  contexts: kubernetesProcedure.query(({ signal }) =>
    kube(() => listKubeContexts(signal ? { signal } : {})),
  ),

  capabilities: kubernetesProcedure
    .input(contextInput)
    .query(({ input, signal }) => probeCapabilities(input.context, signal ? { signal } : {})),

  namespaces: kubernetesProcedure
    .input(contextInput)
    .query(({ input, signal }) =>
      kube(() => listNamespaces(input.context, signal ? { signal } : {})),
    ),

  pods: kubernetesProcedure
    .input(scopeInput)
    .query(({ input, signal }) => kube(() => listPods(input, signal ? { signal } : {}))),

  virtualMachines: kubernetesProcedure
    .input(scopeInput)
    .query(({ input, signal }) => kube(() => listVirtualMachines(input, signal ? { signal } : {}))),

  // Logging in changes only this machine's kubeconfig (and, for a logout, the
  // token's record on the cluster), so these mutations are `local`.

  /** What an API server is and whether its certificates are trusted, before anything is written. */
  probeCluster: kubernetesProcedure
    .input(z.object({ server: kubeServerSchema }))
    .query(({ input, signal }) => probeCluster(input.server, signal ? { signal } : {})),

  /** Each context's login: valid, expired or logged out, and its expiry when the cluster says. */
  loginStatuses: kubernetesProcedure.query(({ signal }) =>
    kube(() => loginStatuses(signal ? { signal } : {})),
  ),

  login: kubernetesProcedure
    .meta({ effect: "local" })
    .input(kubeLoginInputSchema)
    .mutation(({ input, signal }) => kube(() => login(input, signal ? { signal } : {}))),

  relogin: kubernetesProcedure
    .meta({ effect: "local" })
    .input(kubeReloginInputSchema)
    .mutation(({ input, signal }) => kube(() => relogin(input, signal ? { signal } : {}))),

  startBrowserLogin: kubernetesProcedure
    .meta({ effect: "local" })
    .input(kubeBrowserLoginStartSchema)
    .mutation(({ input, signal }) =>
      kube(() => startBrowserLogin(input, signal ? { signal } : {})),
    ),

  /** Resolves once the browser returns to the loopback listener; aborting the request cancels it. */
  completeBrowserLogin: kubernetesProcedure
    .meta({ effect: "local" })
    .input(kubeBrowserLoginIdSchema)
    .mutation(({ input, signal }) =>
      kube(() => completeBrowserLogin(input.loginId, signal ? { signal } : {})),
    ),

  cancelBrowserLogin: kubernetesProcedure
    .meta({ effect: "local" })
    .input(kubeBrowserLoginIdSchema)
    .mutation(({ input }) => cancelBrowserLogin(input.loginId)),

  logout: kubernetesProcedure
    .meta({ effect: "local" })
    .input(contextInput)
    .mutation(({ input }) => kube(() => logout(input.context))),
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
    if (err instanceof DomainError) throw toTrpcError(err);
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
