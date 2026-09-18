/**
 * An SSM Session Manager shell, by way of AWS's own plugin binary.
 *
 * `StartSession` hands back a websocket URL and a token, and the wire protocol
 * on the far end of that URL is a binary framing AWS does not document as a
 * public contract. Rather than reimplement it, we spawn `session-manager-plugin`
 * exactly as the AWS CLI does and pump its stdio - the same thing `aws ssm
 * start-session` is doing, with the same binary, so behaviour matches what the
 * user would get from their terminal.
 *
 * The six positional arguments are the plugin's real interface. They are
 * undocumented, and the order is load-bearing.
 */
import { StartSessionCommand, TerminateSessionCommand } from "@aws-sdk/client-ssm";
import type { ExecHandshakeAuth } from "@faws/contracts";
import { ssmClient } from "@faws/core";

import { ExecSessionError } from "../errors.ts";
import type { ExecDriver, ExecDriverFactory } from "../exec.service.ts";
import { resolveSessionPlugin } from "../sessionPlugin.ts";
import { spawnInteractive, type InteractiveChild } from "../pty.ts";

/** How long to wait for a killed child before insisting. */
const SIGKILL_AFTER_MS = 2000;

/**
 * Turns an SDK fault into something with a next step in it.
 *
 * `TargetNotConnected` is the one that matters: it is by far the most common
 * failure and its bare message tells you nothing about which of the three
 * possible causes you have.
 */
function translate(err: unknown): ExecSessionError {
  const name = (err as { name?: string }).name ?? "Unknown";
  const message = err instanceof Error ? err.message : String(err);

  switch (name) {
    case "TargetNotConnected":
      return new ExecSessionError(
        "TargetNotConnected",
        "That instance is not registered with Session Manager. Check the SSM agent is running on it, that its instance profile includes AmazonSSMManagedInstanceCore, and that its subnet can reach the ssm, ssmmessages and ec2messages endpoints (through a NAT gateway or VPC endpoints).",
      );
    case "InvalidInstanceId":
      return new ExecSessionError(
        "InvalidInstanceId",
        "That instance id is not one SSM recognises here. It may be terminated, in another region, or in another account.",
      );
    case "AccessDeniedException":
      return new ExecSessionError(
        "AccessDenied",
        `Your credentials are not allowed to call ssm:StartSession on this instance. Session Manager is also commonly restricted by a document resource policy. (${message})`,
      );
    case "ExpiredTokenException":
    case "CredentialsProviderError":
      return new ExecSessionError(
        "AccessDenied",
        "Those credentials have expired. Refresh the profile and try again.",
      );
    default:
      return new ExecSessionError("Internal", message);
  }
}

export const ssmDriverFactory: ExecDriverFactory = async (auth, sink, ctx) => {
  if (auth.kind !== "ssm")
    throw new ExecSessionError("Internal", "The SSM driver got a non-SSM handshake.");

  const plugin = resolveSessionPlugin();
  if (!plugin.path) {
    throw new ExecSessionError(
      "SessionManagerPluginMissing",
      plugin.problem ?? "The Session Manager plugin could not be found.",
    );
  }

  const scope = { profile: auth.profile, region: auth.region };
  const client = ssmClient(scope);

  sink.status(`Starting a Session Manager session on ${auth.instanceId}...`);

  const request = {
    Target: auth.instanceId,
    ...(auth.documentName ? { DocumentName: auth.documentName } : {}),
    ...(auth.parameters ? { Parameters: auth.parameters } : {}),
  };

  let started;
  try {
    started = await client.send(new StartSessionCommand(request), { abortSignal: ctx.signal });
  } catch (err) {
    throw translate(err);
  }

  if (!started.SessionId || !started.StreamUrl || !started.TokenValue) {
    throw new ExecSessionError(
      "Internal",
      "SSM started a session but did not return a stream to attach to.",
    );
  }

  const sessionId = started.SessionId;

  // The argument vector the AWS CLI uses. The fifth argument is the whole
  // StartSession request, not just the target, which is what lets port
  // forwarding and SSH tunnelling reuse this same shape later.
  const args = [
    JSON.stringify({
      SessionId: started.SessionId,
      StreamUrl: started.StreamUrl,
      TokenValue: started.TokenValue,
    }),
    auth.region,
    "StartSession",
    auth.profile,
    JSON.stringify(request),
    `https://ssm.${auth.region}.amazonaws.com`,
  ];

  let child: InteractiveChild;
  try {
    child = await spawnInteractive(plugin.path, args, {
      cols: auth.cols,
      rows: auth.rows,
      onDegraded: (why) => sink.status(why),
    });
  } catch (err) {
    await terminate();
    throw new ExecSessionError(
      "SessionManagerPluginFailed",
      err instanceof Error ? err.message : String(err),
    );
  }

  let closing = false;

  child.onData((chunk) => sink.data(chunk));
  child.onExit((code) => {
    if (closing) return;
    closing = true;
    sink.exit(code, code === 0 ? null : "the Session Manager plugin exited");
    void terminate();
  });

  async function terminate(): Promise<void> {
    try {
      await client.send(new TerminateSessionCommand({ SessionId: sessionId }));
    } catch (err) {
      // A session AWS already tore down is the common case here, and it is not
      // worth surfacing. A real failure leaves a session against the account's
      // quota, so it is still worth a line in the log.
      ctx.log.debug({ err, sessionId }, "TerminateSession failed");
    }
  }

  const driver: ExecDriver = {
    write(chunk) {
      if (closing) return;
      child.write(chunk);
    },
    resize(cols, rows) {
      if (closing) return;
      child.resize(cols, rows);
    },
    async close(reason) {
      if (closing) return;
      closing = true;
      ctx.log.info({ reason, sessionId }, "closing SSM session");
      await child.kill(SIGKILL_AFTER_MS);
      await terminate();
    },
  };

  return driver;
};
