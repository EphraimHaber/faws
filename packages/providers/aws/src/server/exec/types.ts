/**
 * The terminal contract from `@faws/kit/server`, filled in with this app's
 * handshake and prompt shapes.
 */
import type {
  ExecHandshakeAuth,
  ExecPrompt,
  ExecPromptResponse,
  SshTransport,
} from "@faws/contracts";
import type {
  ExecDriverFactory as KitExecDriverFactory,
  SshRouteContribution,
} from "@faws/kit/server";

export type { ExecDriver } from "@faws/kit/server";

export type ExecDriverFactory = KitExecDriverFactory<
  ExecHandshakeAuth,
  ExecPrompt,
  ExecPromptResponse
>;

/** A route for one `via` of the SSH handshake, typed to that variant of the transport. */
export type SshRouteFor<Via extends SshTransport["via"]> = SshRouteContribution<
  Via,
  Extract<SshTransport, { via: Via }>
>;
