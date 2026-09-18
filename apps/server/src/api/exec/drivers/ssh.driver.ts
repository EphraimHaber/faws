/**
 * An SSH shell.
 *
 * PTY and resize come from the SSH protocol rather than a local
 * pseudo-terminal: `shell({cols, rows})` sizes the far end and `setWindow`
 * changes it, so none of the node-pty machinery the SSM driver needs applies.
 *
 * The interesting part is reaching the host at all, and that is deliberately
 * not here - `ssh/connect` does one hop and `ssh/transport` gets a byte stream
 * to port 22. This file composes them: a jump chain is a fold over hops, and
 * every route ends with the same three lines opening a shell.
 */
import type { ExecInstanceTarget, SshTransport } from "@faws/contracts";
import { listExecTargets, readSshConfig, resolveSshHost } from "@faws/core";
import type { ClientChannel } from "ssh2";

import { ExecSessionError } from "../errors.ts";
import type { ExecDriver, ExecDriverFactory } from "../exec.service.ts";
import {
  connectHop,
  forwardThrough,
  parseJumpTarget,
  translateSshError,
  type Hop,
} from "../ssh/connect.ts";
import { generateEphemeralKey, sendPublicKey } from "../ssh/instanceConnect.ts";
import { openTransport, type OpenTransport } from "../ssh/transport.ts";

/** Where an Instance Connect key goes, and which address to dial after. */
async function resolveInstance(
  profile: string,
  region: string,
  instanceId: string,
): Promise<ExecInstanceTarget> {
  const targets = await listExecTargets({ profile, region });
  const found = targets.find((target) => target.instanceId === instanceId);
  if (!found) {
    throw new ExecSessionError(
      "InvalidInstanceId",
      `${instanceId} is not an instance this region knows about.`,
    );
  }
  return found;
}

export const sshDriverFactory: ExecDriverFactory = async (auth, sink, ctx) => {
  if (auth.kind !== "ssh") {
    throw new ExecSessionError("Internal", "The SSH driver got a non-SSH handshake.");
  }

  const status = (message: string) => sink.status(message);
  const hopCtx = { status, ask: ctx.ask, log: ctx.log, signal: ctx.signal };

  const opened: OpenTransport[] = [];
  const hops: Hop[] = [];
  let ephemeralScrub: (() => void) | null = null;

  let unwound = false;
  async function unwind(): Promise<void> {
    // Idempotent: a channel closing and an explicit close race routinely, and
    // tearing the chain down twice would close hops in the wrong order the
    // second time. toReversed leaves the arrays alone for the same reason.
    if (unwound) return;
    unwound = true;
    // Innermost first: an outer hop carries the inner one's bytes, so closing
    // it first would drop them on the floor.
    for (const hop of hops.toReversed()) hop.client.end();
    for (const transport of opened.toReversed()) await transport.close();
  }

  try {
    const transport = auth.transport;

    // A jump chain is resolved before anything is dialled, so a typo in the
    // middle of it fails before opening a connection to the first hop.
    const jumps = transport.via === "jump" ? transport.jump : jumpsFromConfig(transport);

    let sock: Awaited<ReturnType<typeof forwardThrough>> | undefined;
    for (const [index, entry] of jumps.entries()) {
      const jump = parseJumpTarget(entry);
      status(`Reaching jump host ${index + 1} of ${jumps.length}: ${jump.host}...`);
      const hop = await connectHop(
        {
          target: jump.host,
          ...(jump.user ? { user: jump.user } : {}),
          ...(jump.port ? { port: jump.port } : {}),
          ...(sock ? { sock } : {}),
        },
        hopCtx,
      );
      hops.push(hop);

      const next = jumps[index + 1];
      if (next) {
        const nextJump = parseJumpTarget(next);
        const resolved = resolveSshHost(readSshConfig(), nextJump.host);
        sock = await forwardThrough(hop, resolved.hostName, nextJump.port ?? resolved.port ?? 22);
      } else {
        sock = undefined;
      }
    }

    // The final hop: its address, its key, and whatever it rides on.
    const final = await finalHopSpec(transport, auth.user, auth.port, status);
    ephemeralScrub = final.scrub;

    if (hops.length > 0) {
      const last = hops.at(-1);
      if (last) sock = await forwardThrough(last, final.host, final.port);
    } else if (final.transport) {
      opened.push(final.transport);
      sock = final.transport.sock;
    }

    const hop = await connectHop(
      {
        target: final.target,
        ...(final.user ? { user: final.user } : {}),
        port: final.port,
        ...(sock ? { sock } : {}),
        ...(final.privateKey ? { privateKey: final.privateKey } : {}),
      },
      hopCtx,
    );
    hops.push(hop);

    // The key was only ever needed for that handshake.
    ephemeralScrub?.();
    ephemeralScrub = null;

    const channel = await new Promise<ClientChannel>((resolve, reject) => {
      hop.client.shell(
        { term: "xterm-256color", cols: auth.cols, rows: auth.rows },
        (err, stream) => (err ? reject(translateSshError(err)) : resolve(stream)),
      );
    });

    let closing = false;
    channel.on("data", (chunk: Buffer) => sink.data(new Uint8Array(chunk)));
    channel.stderr?.on("data", (chunk: Buffer) => sink.data(new Uint8Array(chunk)));
    channel.on("close", () => {
      if (closing) return;
      closing = true;
      sink.exit(null, "the connection closed");
      void unwind();
    });
    channel.on("exit", (code: number | null) => {
      if (closing) return;
      closing = true;
      sink.exit(code, null);
    });

    const driver: ExecDriver = {
      write(chunk) {
        if (!closing) channel.write(Buffer.from(chunk));
      },
      resize(cols, rows) {
        if (!closing) channel.setWindow(rows, cols, 0, 0);
      },
      async close(reason) {
        if (closing) return;
        closing = true;
        ctx.log.info({ reason, host: hop.host }, "closing SSH session");
        channel.close();
        await unwind();
      },
    };

    return driver;
  } catch (err) {
    ephemeralScrub?.();
    await unwind();
    throw translateSshError(err);
  }
};

/** ProxyJump from the config, for a host that did not name a chain itself. */
function jumpsFromConfig(transport: SshTransport): string[] {
  if (transport.via !== "direct") return [];
  return [...resolveSshHost(readSshConfig(), transport.host).proxyJump];
}

interface FinalHop {
  readonly target: string;
  readonly host: string;
  readonly port: number;
  readonly user: string | undefined;
  readonly privateKey?: Buffer;
  readonly transport?: OpenTransport;
  readonly scrub: (() => void) | null;
}

async function finalHopSpec(
  transport: SshTransport,
  user: string | undefined,
  port: number | undefined,
  status: (message: string) => void,
): Promise<FinalHop> {
  const resolvedPort = port ?? 22;

  switch (transport.via) {
    case "direct":
    case "jump": {
      const resolved = resolveSshHost(readSshConfig(), transport.host);
      return {
        target: transport.host,
        host: resolved.hostName,
        port: port ?? resolved.port ?? 22,
        user,
        scrub: null,
      };
    }

    case "ssm-tunnel": {
      const opened = await openTransport(transport, status);
      return {
        target: transport.instanceId,
        host: transport.instanceId,
        port: resolvedPort,
        user,
        transport: opened,
        scrub: null,
      };
    }

    case "ec2-instance-connect": {
      const instance = await resolveInstance(
        transport.profile,
        transport.region,
        transport.instanceId,
      );
      const address = instance.publicIp ?? instance.privateIp;
      if (!address) {
        throw new ExecSessionError(
          "InstanceConnectFailed",
          `${transport.instanceId} has no address to connect to. Reach it with an SSM tunnel instead.`,
        );
      }
      if (!instance.availabilityZone) {
        throw new ExecSessionError(
          "InstanceConnectFailed",
          `${transport.instanceId} reports no availability zone, which Instance Connect requires.`,
        );
      }

      status(`Pushing a one-time key to ${transport.instanceId} for ${transport.osUser}...`);
      const key = generateEphemeralKey();
      try {
        await sendPublicKey(
          { profile: transport.profile, region: transport.region },
          {
            instanceId: transport.instanceId,
            osUser: transport.osUser,
            availabilityZone: instance.availabilityZone,
            publicKeyOpenSsh: key.publicKeyOpenSsh,
          },
        );
      } catch (err) {
        key.scrub();
        throw err;
      }

      return {
        target: address,
        host: address,
        port: resolvedPort,
        user: transport.osUser,
        privateKey: key.privateKey,
        scrub: () => key.scrub(),
      };
    }
  }
}
