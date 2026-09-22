/**
 * Things a session can be opened to, and the ways into each, as plain data.
 *
 * The rules for which way into a machine will actually work - an SSM shell
 * needs the agent, Instance Connect needs an address SSH can reach, `rsh`
 * needs OpenShift - live here rather than in the components that draw the
 * buttons, so the Sessions page, the New Session dialog and the Workloads page
 * cannot disagree about them, and so they can be tested without a browser.
 */
import {
  EXEC_KINDS,
  type ExecInstanceTarget,
  type ExecKind,
  type KubePodInfo,
  resourceKey,
  type ResourceRef,
} from "@faws/contracts";

import { kubeContextRef } from "~/features/kube/scope-link";

import type { ExecTarget } from "./handshake.ts";
import { rankBy } from "../rank.ts";

export interface ConnectAction {
  readonly label: string;
  /** What the action does, for the tooltip. */
  readonly title: string;
  readonly target: ExecTarget;
}

export interface Connectable {
  /** The group it is listed under, which is the kind of its first way in. */
  readonly kind: ExecKind;
  readonly key: string;
  readonly label: string;
  readonly detail: string;
  /** Every name it goes by, for search. */
  readonly text: ReadonlyArray<string>;
  readonly actions: ReadonlyArray<ConnectAction>;
  /** Why there is no way in, when there is none. */
  readonly unavailable: string | null;
  /** What opening it is remembered as, in the recent and pinned lists. */
  readonly ref: ResourceRef;
  /** Whether pinning the row pins the thing on it, rather than something wider. */
  readonly pinnable: boolean;
}

/** Which rows are pinned, and when each was last opened, keyed by `resourceKey`. */
export interface ConnectMemory {
  readonly pinned: ReadonlySet<string>;
  readonly visited: ReadonlyMap<string, string>;
}

export interface ConnectableGroup {
  readonly kind: ExecKind;
  readonly rows: ReadonlyArray<Connectable>;
}

interface AwsScope {
  readonly profile: string;
  readonly region: string;
}

export function instanceActions(row: ExecInstanceTarget, scope: AwsScope): ConnectAction[] {
  const actions: ConnectAction[] = [];
  const { profile, region } = scope;
  const { instanceId } = row;

  if (row.reachableBy.includes("ssm")) {
    actions.push({
      label: "Shell",
      title: "Session Manager shell - no key and no inbound rule needed",
      target: { kind: "ssm", profile, region, instanceId },
    });
  }
  // Instance Connect pushes a key valid for about a minute, so it only makes
  // sense where SSH can actually reach; the tunnel is the way in when it cannot.
  if (row.reachableBy.includes("ssh-public")) {
    actions.push({
      label: "SSH",
      title: `SSH as ${row.osUser} with a one-time key from EC2 Instance Connect`,
      target: {
        kind: "ssh",
        transport: { via: "ec2-instance-connect", profile, region, instanceId, osUser: row.osUser },
      },
    });
  } else if (row.reachableBy.includes("ssh-ssm-tunnel")) {
    actions.push({
      label: "SSH via SSM",
      title: `SSH as ${row.osUser} over an SSM tunnel`,
      target: {
        kind: "ssh",
        transport: { via: "ssm-tunnel", profile, region, instanceId },
        user: row.osUser,
      },
    });
  }
  return actions;
}

export function instanceConnectable(row: ExecInstanceTarget, scope: AwsScope): Connectable {
  const actions = instanceActions(row, scope);
  return {
    kind: "ssm",
    key: `ssm:${row.instanceId}`,
    label: row.name ?? row.instanceId,
    detail: [row.instanceId, row.privateIp, row.instanceType].filter(Boolean).join(" - "),
    text: [row.name ?? "", row.instanceId, row.privateIp ?? "", row.publicIp ?? ""],
    actions,
    unavailable: actions.length > 0 ? null : "No SSM agent, and no public address",
    ref: instanceRef(row, scope),
    pinnable: true,
  };
}

/**
 * An instance, pointed at the row that opens it.
 *
 * There is no page for one instance, so the destination is the instance list
 * filtered to its id - which lands on a row with its own connect buttons
 * rather than on a dead end.
 */
export function instanceRef(row: ExecInstanceTarget, scope: AwsScope): ResourceRef {
  return {
    kind: "ec2-instance",
    id: row.instanceId,
    label: row.name ?? row.instanceId,
    detail: row.instanceId,
    scope: { profile: scope.profile, region: scope.region, connectionId: "" },
    to: `/ec2/instances?q=${encodeURIComponent(row.instanceId)}`,
  };
}

/**
 * An SSH host, scoped to nothing: it is reached from this machine rather than
 * through an AWS account, so it stays listed whichever profile is in view.
 *
 * It points at the Sessions page, which is where a host is connected to from.
 */
export function sshHostRef(host: string, user = ""): ResourceRef {
  return {
    kind: "ssh-host",
    id: user ? `${user}@${host}` : host,
    label: host,
    detail: user ? `ssh ${user}@${host}` : `ssh ${host}`,
    scope: { profile: "", region: "", connectionId: "" },
    to: `/sessions?q=${encodeURIComponent(host)}`,
  };
}

export function podActions(
  row: KubePodInfo,
  context: string,
  namespace: string,
  openShift: boolean,
): ConnectAction[] {
  if (!row.execReady) return [];
  const container = row.containers.find((entry) => !entry.init && entry.ready)?.name;
  const into = { pod: row.name, ...(container ? { container } : {}) };
  const actions: ConnectAction[] = [
    {
      label: "Shell",
      title: `kubectl exec into ${container ?? row.name}`,
      target: { kind: "kube", context, namespace, target: { tool: "kubectl", ...into } },
    },
  ];
  // `rsh` on a cluster that is not OpenShift is a command that will not run.
  if (openShift) {
    actions.push({
      label: "rsh",
      title: `oc rsh into ${container ?? row.name}`,
      target: { kind: "kube", context, namespace, target: { tool: "oc", ...into } },
    });
  }
  return actions;
}

export function podConnectable(
  row: KubePodInfo,
  context: string,
  namespace: string,
  openShift: boolean,
): Connectable {
  const actions = podActions(row, context, namespace, openShift);
  return {
    kind: "kube",
    key: `kube:${context}/${namespace}/${row.name}`,
    label: row.name,
    detail: `${context} / ${namespace}`,
    text: [row.name, ...row.containers.map((entry) => entry.name)],
    actions,
    unavailable:
      actions.length > 0
        ? null
        : `${row.phase}, with ${row.readyContainers} of ${row.totalContainers} containers ready`,
    ref: kubeContextRef(context, namespace),
    pinnable: false,
  };
}

/**
 * A Host alias from `~/.ssh/config`, connected to by its alias so the entry's
 * own user, port and ProxyJump apply rather than being retyped.
 */
export function sshHostConnectable(entry: { host: string; hostName: string }): Connectable {
  return {
    kind: "ssh",
    key: `ssh:${entry.host}`,
    label: entry.host,
    detail: entry.hostName === entry.host ? `ssh ${entry.host}` : entry.hostName,
    text: [entry.host, entry.hostName],
    actions: [
      {
        label: "SSH",
        title: `ssh ${entry.host} (${entry.hostName})`,
        target: { kind: "ssh", transport: { via: "direct", host: entry.host } },
      },
    ],
    unavailable: null,
    ref: sshHostRef(entry.host),
    pinnable: true,
  };
}

/**
 * The rows matching a query, best first, in one group per kind.
 *
 * Ranked across every kind at once and then grouped, so a group's order is
 * still best first; the groups themselves keep the dock's order. With no query
 * there is nothing to rank by, so what was pinned comes first and then what
 * was opened most recently - the rows someone is most likely looking for.
 */
export function searchConnectables(
  rows: ReadonlyArray<Connectable>,
  query: string,
  memory?: ConnectMemory,
): ConnectableGroup[] {
  const ranked = query.trim()
    ? rankBy(rows, query.trim(), (row) => row.text)
    : memory
      ? byMemory(rows, memory)
      : rows;
  return EXEC_KINDS.map((kind) => ({
    kind,
    rows: ranked.filter((row) => row.kind === kind),
  })).filter((group) => group.rows.length > 0);
}

function byMemory(rows: ReadonlyArray<Connectable>, memory: ConnectMemory): Connectable[] {
  const rank = (row: Connectable) => {
    const key = resourceKey(row.ref);
    return { pinned: row.pinnable && memory.pinned.has(key), at: memory.visited.get(key) ?? "" };
  };
  return rows
    .map((row, index) => ({ row, index, ...rank(row) }))
    .toSorted(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) || b.at.localeCompare(a.at) || a.index - b.index,
    )
    .map((entry) => entry.row);
}
