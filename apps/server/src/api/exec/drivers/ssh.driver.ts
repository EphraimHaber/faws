/**
 * An SSH shell.
 *
 * PTY and resize come from the SSH protocol rather than a local
 * pseudo-terminal: `shell({cols, rows})` sizes the far end and `setWindow`
 * changes it, so none of the node-pty machinery the SSM driver needs applies.
 *
 * The interesting part is reaching the host at all, and that is deliberately
 * not here - `ssh/connect` does one hop, and a route gets the last hop a byte
 * stream or a key when dialling it is not enough. This file composes them: a
 * jump chain is a fold over hops, and every route ends with the same three
 * lines opening a shell.
 *
 * `direct` and `jump` are the host's own. Every other `transport.via` is a
 * route a provider contributes (an SSM tunnel, an EC2 Instance Connect key),
 * registered here with the provider it came from so the handshake can refuse
 * it while that provider is switched off.
 */
import type { ExecHandshakeAuth, SshTransport } from "@faws/contracts";
import { readSshConfig, resolveSshHost } from "@faws/core";
import type { SshRoute, SshRouteContext, SshRouteContribution } from "@faws/kit/server";
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

/** The transports the host reaches by itself. */
type HostVia = "direct" | "jump";

interface RegisteredRoute {
  readonly provider: string;
  readonly route: SshRouteContribution<string, SshTransport>;
}

const routes = new Map<string, RegisteredRoute>();

/** Adds a provider's way of reaching an SSH host, for the handshakes whose `transport.via` it names. */
export function registerSshRoute(
  provider: string,
  route: SshRouteContribution<Exclude<SshTransport["via"], HostVia>, SshTransport>,
): void {
  routes.set(route.via, { provider, route });
}

/**
 * The provider whose route would serve this SSH handshake, or null for one the
 * host dials itself. Registered as the SSH driver's provider, so
 * SSH over an SSM tunnel is refused while AWS is switched off.
 */
export function sshProvider(auth: ExecHandshakeAuth): string | null {
  if (auth.kind !== "ssh") return null;
  return routes.get(auth.transport.via)?.provider ?? null;
}

export const sshDriverFactory: ExecDriverFactory = async (auth, sink, ctx) => {
  if (auth.kind !== "ssh") {
    throw new ExecSessionError("Internal", "The SSH driver got a non-SSH handshake.");
  }

  const status = (message: string) => sink.status(message);
  const hopCtx = { status, ask: ctx.ask, log: ctx.log, signal: ctx.signal };

  const opened: SshRoute[] = [];
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
    for (const route of opened.toReversed()) await route.close?.();
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
    const final = await finalHopSpec(transport, auth.user, auth.port, {
      status,
      log: ctx.log,
      signal: ctx.signal,
    });
    const route = final.route;
    if (route) opened.push(route);
    ephemeralScrub = route?.scrub ? () => route.scrub?.() : null;

    if (hops.length > 0) {
      const last = hops.at(-1);
      if (last) sock = await forwardThrough(last, final.host, final.port);
    } else if (route?.sock) {
      sock = route.sock;
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
  /** Present when a provider's route reached this hop. */
  readonly route?: SshRoute;
}

async function finalHopSpec(
  transport: SshTransport,
  user: string | undefined,
  port: number | undefined,
  ctx: SshRouteContext,
): Promise<FinalHop> {
  if (transport.via === "direct" || transport.via === "jump") {
    const resolved = resolveSshHost(readSshConfig(), transport.host);
    return {
      target: transport.host,
      host: resolved.hostName,
      port: port ?? resolved.port ?? 22,
      user,
    };
  }

  const registered = routes.get(transport.via);
  if (!registered) {
    throw new ExecSessionError(
      "NoDriver",
      `This build has no way to reach an SSH host over ${transport.via}.`,
    );
  }
  const route = await registered.route.open(transport, { user, port }, ctx);
  return {
    target: route.target,
    host: route.target,
    port: route.port,
    user: route.user,
    ...(route.privateKey ? { privateKey: route.privateKey } : {}),
    route,
  };
}
