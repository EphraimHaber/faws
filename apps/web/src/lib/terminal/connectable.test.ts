import type { ExecInstanceTarget, KubePodInfo } from "@faws/contracts";
import { describe, expect, it } from "vitest";

import {
  instanceActions,
  instanceConnectable,
  podActions,
  podConnectable,
  searchConnectables,
  sshHostConnectable,
} from "./connectable.ts";

const scope = { profile: "prod", region: "eu-west-1" };

function instance(overrides: Partial<ExecInstanceTarget> = {}): ExecInstanceTarget {
  return {
    instanceId: "i-0abc",
    name: "api-1",
    state: "running",
    privateIp: "10.0.0.5",
    publicIp: null,
    availabilityZone: null,
    platform: null,
    instanceType: "t3.small",
    vpcId: null,
    keyName: null,
    osUser: "ec2-user",
    ssmManaged: true,
    ssmPingStatus: "Online",
    reachableBy: ["ssm"],
    ...overrides,
  } as ExecInstanceTarget;
}

function pod(overrides: Partial<KubePodInfo> = {}): KubePodInfo {
  return {
    name: "api-7d9f",
    namespace: "web",
    phase: "Running",
    readyContainers: 1,
    totalContainers: 2,
    restarts: 0,
    nodeName: null,
    podIp: null,
    createdAt: null,
    containers: [
      { name: "init-db", image: "i", ready: false, restarts: 0, state: "terminated", init: true },
      { name: "api", image: "i", ready: true, restarts: 0, state: "running", init: false },
    ],
    execReady: true,
    ...overrides,
  } as KubePodInfo;
}

describe("instanceActions", () => {
  it("offers an SSM shell, and SSH through Instance Connect where there is a public address", () => {
    const actions = instanceActions(instance({ reachableBy: ["ssm", "ssh-public"] }), scope);
    expect(actions.map((action) => action.label)).toEqual(["Shell", "SSH"]);
    expect(actions[0]?.target).toEqual({
      kind: "ssm",
      profile: "prod",
      region: "eu-west-1",
      instanceId: "i-0abc",
    });
    expect(actions[1]?.target).toMatchObject({
      kind: "ssh",
      transport: { via: "ec2-instance-connect", instanceId: "i-0abc", osUser: "ec2-user" },
    });
  });

  it("falls back to SSH over an SSM tunnel when there is no public address", () => {
    const actions = instanceActions(instance({ reachableBy: ["ssm", "ssh-ssm-tunnel"] }), scope);
    expect(actions.map((action) => action.label)).toEqual(["Shell", "SSH via SSM"]);
    expect(actions[1]?.target).toMatchObject({
      kind: "ssh",
      transport: { via: "ssm-tunnel" },
      user: "ec2-user",
    });
  });

  it("offers nothing for an instance nothing can reach, and says why", () => {
    const unreachable = instance({ reachableBy: [] });
    expect(instanceActions(unreachable, scope)).toEqual([]);
    expect(instanceConnectable(unreachable, scope).unavailable).toBe(
      "No SSM agent, and no public address",
    );
  });
});

describe("podActions", () => {
  it("execs into the first ready container that is not an init container", () => {
    const [shell] = podActions(pod(), "prod", "web", false);
    expect(shell?.target).toEqual({
      kind: "kube",
      context: "prod",
      namespace: "web",
      target: { tool: "kubectl", pod: "api-7d9f", container: "api" },
    });
  });

  it("adds rsh only on OpenShift", () => {
    expect(podActions(pod(), "prod", "web", false).map((a) => a.label)).toEqual(["Shell"]);
    expect(podActions(pod(), "prod", "web", true).map((a) => a.label)).toEqual(["Shell", "rsh"]);
  });

  it("offers nothing for a pod with no ready container, and says why", () => {
    const starting = pod({ execReady: false, phase: "Pending", readyContainers: 0 });
    expect(podActions(starting, "prod", "web", false)).toEqual([]);
    expect(podConnectable(starting, "prod", "web", false).unavailable).toBe(
      "Pending, with 0 of 2 containers ready",
    );
  });
});

describe("sshHostConnectable", () => {
  it("connects to a ~/.ssh/config alias by name, so its own settings apply", () => {
    const row = sshHostConnectable({ host: "bastion", hostName: "10.1.2.3" });
    expect(row.actions[0]?.target).toEqual({
      kind: "ssh",
      transport: { via: "direct", host: "bastion" },
    });
    expect(row.detail).toBe("10.1.2.3");
  });

  it("does not repeat an alias that is already the address", () => {
    expect(sshHostConnectable({ host: "10.1.2.3", hostName: "10.1.2.3" }).detail).toBe(
      "ssh 10.1.2.3",
    );
  });
});

describe("searchConnectables", () => {
  const rows = [
    instanceConnectable(instance({ instanceId: "i-0abc", name: "api-1" }), scope),
    instanceConnectable(instance({ instanceId: "i-0def", name: "worker-1" }), scope),
    sshHostConnectable({ host: "bastion", hostName: "10.1.2.3" }),
    podConnectable(pod({ name: "api-7d9f" }), "prod", "web", false),
  ];

  it("keeps everything, grouped by kind, when there is no query", () => {
    expect(searchConnectables(rows, "").map((group) => [group.kind, group.rows.length])).toEqual([
      ["ssm", 2],
      ["ssh", 1],
      ["kube", 1],
    ]);
  });

  it("matches by any name a row goes by, across kinds", () => {
    const found = searchConnectables(rows, "api");
    expect(found.flatMap((group) => group.rows.map((row) => row.key))).toEqual([
      "ssm:i-0abc",
      "kube:prod/web/api-7d9f",
    ]);
    expect(searchConnectables(rows, "10.1.2").flatMap((g) => g.rows.map((r) => r.key))).toEqual([
      "ssh:bastion",
    ]);
  });
});
