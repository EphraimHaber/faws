import { describe, expect, it } from "vitest";

import { buildHandshake, describeTarget, type ExecTarget } from "./handshake.ts";

const options = {
  sessionId: "11111111-2222-3333-4444-555555555555",
  cols: 120,
  rows: 40,
  record: true,
};

describe("buildHandshake", () => {
  it("builds an ECS handshake with a default shell", () => {
    const auth = buildHandshake(
      {
        kind: "ecs",
        profile: "default",
        region: "eu-west-1",
        cluster: "prod",
        taskId: "t1",
        containerName: "app",
      },
      options,
    );
    expect(auth).toMatchObject({
      kind: "ecs",
      cluster: "prod",
      containerName: "app",
      command: "/bin/sh",
      cols: 120,
      rows: 40,
      attach: false,
    });
  });

  it("keeps an explicit shell", () => {
    const auth = buildHandshake(
      {
        kind: "ecs",
        profile: "d",
        region: "r",
        cluster: "c",
        taskId: "t",
        containerName: "app",
        command: "/bin/bash",
      },
      options,
    );
    expect(auth).toMatchObject({ command: "/bin/bash" });
  });

  it("builds an SSM handshake", () => {
    const auth = buildHandshake(
      { kind: "ssm", profile: "default", region: "il-central-1", instanceId: "i-0abc" },
      options,
    );
    expect(auth).toMatchObject({ kind: "ssm", instanceId: "i-0abc", region: "il-central-1" });
  });

  it("builds an SSH handshake with no AWS scope at all", () => {
    const auth = buildHandshake(
      { kind: "ssh", transport: { via: "direct", host: "box" } },
      options,
    );
    expect(auth).toMatchObject({ kind: "ssh", transport: { via: "direct", host: "box" } });
    expect(auth).not.toHaveProperty("profile");
    expect(auth).not.toHaveProperty("region");
  });

  it("omits an absent user rather than sending undefined", () => {
    const auth = buildHandshake(
      { kind: "ssh", transport: { via: "direct", host: "box" } },
      options,
    );
    expect(Object.keys(auth)).not.toContain("user");
    expect(Object.keys(auth)).not.toContain("port");
  });

  it("carries an explicit user and port", () => {
    const auth = buildHandshake(
      { kind: "ssh", transport: { via: "direct", host: "box" }, user: "ubuntu", port: 2222 },
      options,
    );
    expect(auth).toMatchObject({ user: "ubuntu", port: 2222 });
  });

  it("marks a reattach", () => {
    const auth = buildHandshake(
      { kind: "ssm", profile: "p", region: "r", instanceId: "i" },
      { ...options, attach: true },
    );
    expect(auth.attach).toBe(true);
  });

  it("never carries a secret-bearing field", () => {
    const targets: ExecTarget[] = [
      { kind: "ecs", profile: "p", region: "r", cluster: "c", taskId: "t", containerName: "n" },
      { kind: "ssm", profile: "p", region: "r", instanceId: "i" },
      { kind: "ssh", transport: { via: "direct", host: "h" } },
      {
        kind: "ssh",
        transport: {
          via: "ec2-instance-connect",
          profile: "p",
          region: "r",
          instanceId: "i",
          osUser: "ec2-user",
        },
      },
      { kind: "ssh", transport: { via: "ssm-tunnel", profile: "p", region: "r", instanceId: "i" } },
    ];
    const banned = /password|passphrase|secret|token|privatekey|credential/i;
    for (const target of targets) {
      const serialised = JSON.stringify(buildHandshake(target, options));
      for (const field of Object.keys(JSON.parse(serialised) as Record<string, unknown>)) {
        expect(field).not.toMatch(banned);
      }
    }
  });
});

describe("describeTarget", () => {
  it("labels an ECS container by name, with its cluster underneath", () => {
    expect(
      describeTarget({
        kind: "ecs",
        profile: "p",
        region: "r",
        cluster: "prod",
        taskId: "abcdef0123456789",
        containerName: "app",
      }),
    ).toEqual({ title: "app", subtitle: "prod / abcdef012345" });
  });

  it("labels an SSM target by instance, with its scope underneath", () => {
    expect(
      describeTarget({
        kind: "ssm",
        profile: "default",
        region: "eu-west-1",
        instanceId: "i-0abc",
      }),
    ).toEqual({
      title: "i-0abc",
      subtitle: "default / eu-west-1",
    });
  });

  it("shows the jump chain for a proxied host", () => {
    expect(
      describeTarget({
        kind: "ssh",
        transport: { via: "jump", host: "db", jump: ["bastion"] },
        user: "ubuntu",
      }),
    ).toEqual({ title: "db", subtitle: "ssh ubuntu@db via bastion" });
  });

  it("says how a private instance is being reached", () => {
    expect(
      describeTarget({
        kind: "ssh",
        transport: { via: "ssm-tunnel", profile: "p", region: "eu-west-1", instanceId: "i-0abc" },
      }),
    ).toEqual({ title: "i-0abc", subtitle: "ssh over ssm / eu-west-1" });
  });
});
