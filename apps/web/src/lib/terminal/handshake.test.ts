import { describe, expect, it } from "vitest";

import { buildHandshake, describeTarget, type ExecTarget, scopeOf } from "./handshake.ts";

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

  it("builds a kube handshake with the pod's default shell and no container", () => {
    const auth = buildHandshake(
      {
        kind: "kube",
        context: "prod",
        namespace: "payments",
        target: { tool: "kubectl", pod: "api-7f9" },
      },
      options,
    );
    expect(auth).toMatchObject({
      kind: "kube",
      context: "prod",
      namespace: "payments",
      target: { tool: "kubectl", pod: "api-7f9", command: ["/bin/sh"] },
    });
    // Absent means "the one kubectl would pick", which is not what an explicit
    // undefined means to a strict schema.
    expect(Object.keys((auth as { target: object }).target)).not.toContain("container");
  });

  it("defaults an oc session to rsh, which is what an OpenShift user reaches for", () => {
    const auth = buildHandshake(
      {
        kind: "kube",
        context: "ocp",
        namespace: "team",
        target: { tool: "oc", pod: "api-7f9", container: "app" },
      },
      options,
    );
    expect(auth).toMatchObject({ target: { tool: "oc", mode: "rsh", container: "app" } });
  });

  it("carries a virtctl target with no pod fields at all", () => {
    const auth = buildHandshake(
      {
        kind: "kube",
        context: "lab",
        namespace: "vms",
        target: { tool: "virtctl", mode: "ssh", vm: "win11", user: "admin" },
      },
      options,
    );
    expect(auth).toMatchObject({
      target: { tool: "virtctl", mode: "ssh", vm: "win11", user: "admin" },
    });
    expect(auth).not.toHaveProperty("profile");
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

describe("asking SSM for bash", () => {
  const ssm: ExecTarget = { kind: "ssm", profile: "p", region: "r", instanceId: "i-0abc" };

  it("asks only when the setting is on", () => {
    expect(buildHandshake(ssm, { ...options, ssmBash: true })).toMatchObject({ preferBash: true });
    expect(buildHandshake(ssm, options)).not.toHaveProperty("preferBash");
  });

  it("never asks on behalf of a session that is not SSM", () => {
    const pod: ExecTarget = {
      kind: "kube",
      context: "prod",
      namespace: "web",
      target: { tool: "kubectl", pod: "api-7d9f" },
    };
    expect(buildHandshake(pod, { ...options, ssmBash: true })).not.toHaveProperty("preferBash");
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

  it("labels a pod by its container, with the kube scope and no AWS one", () => {
    expect(
      describeTarget({
        kind: "kube",
        context: "prod",
        namespace: "payments",
        target: { tool: "kubectl", pod: "api-7f9", container: "app" },
      }),
    ).toEqual({ title: "app", subtitle: "prod / payments" });
  });

  it("names the virtctl mode, since ssh and console are different sessions", () => {
    expect(
      describeTarget({
        kind: "kube",
        context: "lab",
        namespace: "vms",
        target: { tool: "virtctl", mode: "console", vm: "win11" },
      }),
    ).toEqual({ title: "win11", subtitle: "virtctl console / lab / vms" });
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

describe("scopeOf", () => {
  it("scopes ECS by account and region as well as cluster, since cluster names repeat", () => {
    expect(
      scopeOf({
        kind: "ecs",
        profile: "prod",
        region: "eu-west-1",
        cluster: "api",
        taskId: "abcdef0123456789",
        containerName: "app",
      }),
    ).toBe("prod / eu-west-1 / api");
  });

  it("scopes SSM by account and region", () => {
    expect(
      scopeOf({ kind: "ssm", profile: "default", region: "eu-west-1", instanceId: "i-0abc" }),
    ).toBe("default / eu-west-1");
  });

  it("scopes SSH by the host it lands on, whatever carries it there", () => {
    expect(
      scopeOf({
        kind: "ssh",
        user: "ec2-user",
        transport: { via: "jump", host: "db.internal", jump: ["bastion"] },
      } as ExecTarget),
    ).toBe("db.internal");
  });

  it("scopes Kubernetes by context and namespace, for kubectl and virtctl alike", () => {
    const pod: ExecTarget = {
      kind: "kube",
      context: "prod",
      namespace: "web",
      target: { tool: "kubectl", pod: "api-7d9f", command: ["/bin/sh"] },
    };
    const vm: ExecTarget = {
      kind: "kube",
      context: "prod",
      namespace: "web",
      target: { tool: "virtctl", mode: "console", vm: "vm-1" },
    };
    expect(scopeOf(pod)).toBe("prod / web");
    expect(scopeOf(vm)).toBe("prod / web");
  });
});
