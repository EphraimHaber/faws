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
import type { ExecHandshakeAuth, KubeTarget, SshTransport } from "@faws/contracts";

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
  | { kind: "ssh"; transport: SshTransport; user?: string; port?: number }
  | { kind: "kube"; context: string; namespace: string; target: KubeExecTarget };

/**
 * What to run in the cluster, as a caller has it rather than as the wire wants
 * it.
 *
 * The contract's `KubeTarget` is the parsed shape, so its defaults are already
 * applied and `command` is a required argv. A page has none of that: it knows a
 * pod and perhaps a container, and means "whatever shell the pod has" by saying
 * nothing at all. Filling those in is this module's job, the same split it
 * already makes for an ECS command.
 */
export type KubeExecTarget =
  | { tool: "kubectl"; pod: string; container?: string; command?: readonly string[] }
  | {
      tool: "oc";
      /** `rsh` is what an OpenShift user reaches for; `exec` is the same call. */
      mode?: "rsh" | "exec";
      pod: string;
      container?: string;
      command?: readonly string[];
    }
  | { tool: "virtctl"; mode: "ssh" | "console"; vm: string; user?: string };

/** Whatever the image actually has; a distroless one has neither. */
const DEFAULT_SHELL = ["/bin/sh"] as const;

export interface HandshakeOptions {
  readonly sessionId: string;
  readonly cols: number;
  readonly rows: number;
  readonly record: boolean;
  /** True when resuming a tab whose socket dropped. */
  readonly attach?: boolean;
  /** The `terminal.ssmBash` setting, which only an SSM session reads. */
  readonly ssmBash?: boolean;
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
        ...(options.ssmBash ? { preferBash: true } : {}),
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
    case "kube":
      return {
        ...base,
        kind: "kube",
        context: target.context,
        namespace: target.namespace,
        target: kubeTarget(target.target),
      };
  }
}

/**
 * The same spread-rather-than-assign rule the SSH arm follows, and for the same
 * reason: the server's schema is strict, so an absent container - which means
 * "the one `kubectl exec` would pick" - is a missing key rather than a present
 * one holding `undefined`.
 */
function kubeTarget(target: KubeExecTarget): KubeTarget {
  switch (target.tool) {
    case "kubectl":
      return {
        tool: "kubectl",
        pod: target.pod,
        ...(target.container ? { container: target.container } : {}),
        command: [...(target.command ?? DEFAULT_SHELL)],
      };
    case "oc":
      return {
        tool: "oc",
        mode: target.mode ?? "rsh",
        pod: target.pod,
        ...(target.container ? { container: target.container } : {}),
        command: [...(target.command ?? DEFAULT_SHELL)],
      };
    case "virtctl":
      return {
        tool: "virtctl",
        mode: target.mode,
        vm: target.vm,
        ...(target.user ? { user: target.user } : {}),
      };
  }
}

/** A short tab label and the line under it, per kind. */
/**
 * Which environment a session is in, for ordering tabs of one kind together.
 *
 * Not the subtitle: that is written to be read and varies with the transport,
 * so a kubectl shell and a virtctl console on the same namespace would sort
 * apart.
 */
export function scopeOf(target: ExecTarget): string {
  switch (target.kind) {
    case "ecs":
      return `${target.profile} / ${target.region} / ${target.cluster}`;
    case "ssm":
      return `${target.profile} / ${target.region}`;
    case "ssh":
      return target.transport.via === "direct" || target.transport.via === "jump"
        ? target.transport.host
        : target.transport.instanceId;
    case "kube":
      return `${target.context} / ${target.namespace}`;
  }
}

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
    case "kube": {
      // Context and namespace rather than profile and region: a kube session
      // has no AWS scope at all, and the pair under the tab has to be the pair
      // that decides which cluster the shell landed in.
      const scope = `${target.context} / ${target.namespace}`;
      const inner = target.target;
      switch (inner.tool) {
        case "kubectl":
        case "oc":
          return { title: inner.container ?? inner.pod, subtitle: scope };
        case "virtctl":
          return { title: inner.vm, subtitle: `virtctl ${inner.mode} / ${scope}` };
      }
    }
  }
}
