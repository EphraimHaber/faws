/**
 * SSH to an instance with no route to it, over an SSM tunnel.
 *
 * `AWS-StartSSHSession` forwards the instance's port 22 rather than starting a
 * shell, and the Session Manager plugin carries the raw bytes on its stdio.
 * Contributed to the host's SSH driver as the `ssm-tunnel` route: this module
 * hands it the stream, and the host does the SSH over it, host key and all.
 */
import type { SshTransport } from "@faws/contracts";
import { ssmClient } from "@faws/core";
import { StartSessionCommand, TerminateSessionCommand } from "@aws-sdk/client-ssm";
import { spawnTunnel, type SshRoute } from "@faws/kit/server";

import { ExecSessionError } from "./errors.ts";
import { resolveSessionPlugin } from "./sessionPlugin.ts";
import type { SshRouteFor } from "./types.ts";

export const ssmTunnelRoute: SshRouteFor<"ssm-tunnel"> = {
  via: "ssm-tunnel",
  async open(transport, requested, ctx) {
    const tunnel = await openSsmTunnel(transport, (message) => ctx.status(message));
    return {
      // The instance id, not an address: the stream already reaches it, and
      // the host key is remembered against the name the person picked.
      target: transport.instanceId,
      port: requested.port ?? 22,
      user: requested.user,
      ...tunnel,
    };
  },
};

async function openSsmTunnel(
  transport: Extract<SshTransport, { via: "ssm-tunnel" }>,
  report: (message: string) => void,
): Promise<Required<Pick<SshRoute, "sock" | "close">>> {
  const plugin = resolveSessionPlugin();
  if (!plugin.path) {
    throw new ExecSessionError(
      "SessionManagerPluginMissing",
      plugin.problem ?? "The Session Manager plugin could not be found.",
    );
  }

  const scope = { profile: transport.profile, region: transport.region };
  const client = ssmClient(scope);

  report(`Opening an SSM tunnel to ${transport.instanceId}...`);

  // AWS-StartSSHSession is the document that forwards a port rather than
  // starting a shell; the plugin then carries raw bytes on its stdio.
  const request = {
    Target: transport.instanceId,
    DocumentName: "AWS-StartSSHSession",
    Parameters: { portNumber: ["22"] },
  };

  let started;
  try {
    started = await client.send(new StartSessionCommand(request));
  } catch (err) {
    const name = (err as { name?: string }).name ?? "Unknown";
    if (name === "TargetNotConnected") {
      throw new ExecSessionError(
        "TargetNotConnected",
        `${transport.instanceId} is not registered with Session Manager, so there is nothing to tunnel through. The SSM agent must be running and the instance role needs AmazonSSMManagedInstanceCore.`,
      );
    }
    throw new ExecSessionError("Internal", err instanceof Error ? err.message : String(err));
  }

  if (!started.SessionId || !started.StreamUrl || !started.TokenValue) {
    throw new ExecSessionError("Internal", "SSM returned no stream to tunnel through.");
  }

  const sessionId = started.SessionId;
  const args = [
    JSON.stringify({
      SessionId: started.SessionId,
      StreamUrl: started.StreamUrl,
      TokenValue: started.TokenValue,
    }),
    transport.region,
    "StartSession",
    transport.profile,
    JSON.stringify(request),
    `https://ssm.${transport.region}.amazonaws.com`,
  ];

  // Plain pipes, never a pty. A pseudo-terminal would translate CR/LF and act
  // on control characters in what is an opaque byte stream, corrupting the SSH
  // protocol riding over it - and window size is meaningless here, because ssh2
  // owns the terminal on the channel inside this tunnel.
  const child = spawnTunnel(plugin.path, args, {
    onStderr: (line) => report(line.trim()),
  });

  return {
    sock: child.stream,
    close: async () => {
      child.kill();
      try {
        await client.send(new TerminateSessionCommand({ SessionId: sessionId }));
      } catch {
        // A session AWS already tore down is the ordinary case here.
      }
    },
  };
}
