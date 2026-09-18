/**
 * Builds the `auth` payload a `/exec` socket connects with.
 *
 * One place, because the server parses this against a zod union and a field in
 * the wrong shape fails the connection rather than degrading - so the mapping
 * from "what the user picked" to "what the server expects" is worth having in
 * a function with tests rather than inline at three call sites.
 *
 * Nothing secret goes in a handshake. Passphrases and host-key decisions are
 * answered over the prompt roundtrip once the session is up, where they are
 * never stored, never logged and never sent again.
 */
import type { ExecHandshakeAuth, SshTransport } from "@faws/contracts";

export type ExecTarget =
  | {
      kind: "ecs";
      profile: string;
      region: string;
      cluster: string;
      taskId: string;
      containerName: string;
      command?: string;
    }
  | { kind: "ssm"; profile: string; region: string; instanceId: string }
  | { kind: "ssh"; transport: SshTransport; user?: string; port?: number };

export interface HandshakeOptions {
  readonly sessionId: string;
  readonly cols: number;
  readonly rows: number;
  readonly record: boolean;
  /** True when resuming a tab whose socket dropped. */
  readonly attach?: boolean;
}

export function buildHandshake(target: ExecTarget, options: HandshakeOptions): ExecHandshakeAuth {
  const base = {
    sessionId: options.sessionId,
    cols: options.cols,
    rows: options.rows,
    record: options.record,
    attach: options.attach ?? false,
  };

  switch (target.kind) {
    case "ecs":
      return {
        ...base,
        kind: "ecs",
        profile: target.profile,
        region: target.region,
        cluster: target.cluster,
        taskId: target.taskId,
        containerName: target.containerName,
        command: target.command ?? "/bin/sh",
      };
    case "ssm":
      return {
        ...base,
        kind: "ssm",
        profile: target.profile,
        region: target.region,
        instanceId: target.instanceId,
      };
    case "ssh":
      return {
        ...base,
        kind: "ssh",
        transport: target.transport,
        // Spread rather than assign undefined: the server's schema is strict,
        // and "absent" means "let ~/.ssh/config decide" while an explicit
        // undefined is a different thing entirely.
        ...(target.user === undefined ? {} : { user: target.user }),
        ...(target.port === undefined ? {} : { port: target.port }),
      };
  }
}

/** A short tab label and the line under it, per kind. */
export function describeTarget(target: ExecTarget): { title: string; subtitle: string } {
  switch (target.kind) {
    case "ecs":
      return {
        title: target.containerName,
        subtitle: `${target.cluster} / ${target.taskId.slice(0, 12)}`,
      };
    case "ssm":
      return { title: target.instanceId, subtitle: `${target.profile} / ${target.region}` };
    case "ssh": {
      const transport = target.transport;
      const host =
        transport.via === "direct" || transport.via === "jump"
          ? transport.host
          : transport.instanceId;
      const user = target.user ? `${target.user}@` : "";
      switch (transport.via) {
        case "direct":
          return { title: host, subtitle: `ssh ${user}${host}` };
        case "jump":
          return { title: host, subtitle: `ssh ${user}${host} via ${transport.jump.join(", ")}` };
        case "ec2-instance-connect":
          return { title: host, subtitle: `instance connect / ${transport.region}` };
        case "ssm-tunnel":
          return { title: host, subtitle: `ssh over ssm / ${transport.region}` };
      }
    }
  }
}
