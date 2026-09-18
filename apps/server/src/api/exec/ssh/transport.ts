/**
 * Getting a byte stream to port 22, whatever stands between here and there.
 *
 * Four answers to one question, behind one function, because "how do I reach
 * this host" is genuinely different from "what do I do once I get there" and
 * the SSH driver should only have to care about the second.
 *
 *   direct       the host is routable; ssh2 dials it itself
 *   ssm-tunnel   no public address, so AWS-StartSSHSession carries the bytes
 *   jump         reach the first hop, then forward a channel through it
 *   ec2-instance-connect  routable, but the key is pushed for this session only
 *
 * `jump` recurses through this same function, so a bastion can itself be
 * reached over SSM. Each hop verifies its own host key and the chain tears down
 * innermost first.
 */
import type { Duplex } from "node:stream";

import type { SshTransport } from "@faws/contracts";
import { ssmClient } from "@faws/core";
import { StartSessionCommand, TerminateSessionCommand } from "@aws-sdk/client-ssm";

import { ExecSessionError } from "../errors.ts";
import { spawnTunnel } from "../pty.ts";
import { resolveSessionPlugin } from "../sessionPlugin.ts";

export interface OpenTransport {
  /** Passed to ssh2 as `sock`; absent means "dial it yourself". */
  readonly sock?: Duplex;
  close(): Promise<void>;
}

export async function openTransport(
  transport: SshTransport,
  report: (message: string) => void,
): Promise<OpenTransport> {
  switch (transport.via) {
    case "direct":
    case "ec2-instance-connect":
      // Both are ordinary TCP from here; Instance Connect only changes which
      // key is offered, which the driver handles.
      return { close: async () => {} };

    case "ssm-tunnel":
      return openSsmTunnel(transport, report);

    case "jump":
      throw new ExecSessionError(
        "Internal",
        "Jump hosts are resolved by the driver, not the transport.",
      );
  }
}

async function openSsmTunnel(
  transport: Extract<SshTransport, { via: "ssm-tunnel" }>,
  report: (message: string) => void,
): Promise<OpenTransport> {
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
