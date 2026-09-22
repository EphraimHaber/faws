import { describe, expect, it } from "vitest";

import { EXEC_KINDS, execHandshakeSchema, execKindSchema } from "./exec.ts";

const base = {
  kind: "kube",
  sessionId: "8f1d6a4c-4a1e-4f2b-9a2f-2f2a2c0f5d11",
  cols: 120,
  rows: 40,
  context: "arn:aws:eks:eu-west-1:123456789012:cluster/prod",
  namespace: "default",
};

function parse(target: unknown) {
  return execHandshakeSchema.safeParse({ ...base, target });
}

describe("the kube arm", () => {
  it("parses a kubectl exec", () => {
    const result = parse({ tool: "kubectl", pod: "api-7d9f", container: "api" });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      kind: "kube",
      // Nothing about the image is knowable from here, and alpine has no bash.
      target: { tool: "kubectl", pod: "api-7d9f", container: "api", command: ["/bin/sh"] },
    });
  });

  it("defaults oc to rsh", () => {
    const result = parse({ tool: "oc", pod: "api-7d9f" });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ target: { tool: "oc", mode: "rsh" } });
  });

  it("parses a virtctl console", () => {
    expect(parse({ tool: "virtctl", mode: "console", vm: "builder" }).success).toBe(true);
  });
});

describe("the fence around names", () => {
  it("rejects a pod name that is really a flag", () => {
    // The one that matters: a value read as the next flag is how a shell
    // handshake turns into "read me any file the server can open".
    expect(parse({ tool: "kubectl", pod: "--kubeconfig=/etc/shadow" }).success).toBe(false);
  });

  it("rejects a container name that is really a flag", () => {
    expect(parse({ tool: "kubectl", pod: "api-7d9f", container: "-n" }).success).toBe(false);
  });

  it("rejects a context with whitespace in it", () => {
    expect(
      execHandshakeSchema.safeParse({
        ...base,
        context: "prod --kubeconfig /etc/shadow",
        target: { tool: "kubectl", pod: "api-7d9f" },
      }).success,
    ).toBe(false);
  });

  it("rejects a context starting with a dash", () => {
    expect(
      execHandshakeSchema.safeParse({
        ...base,
        context: "-kubeconfig=/etc/shadow",
        target: { tool: "kubectl", pod: "api-7d9f" },
      }).success,
    ).toBe(false);
  });

  it("rejects a namespace that is not a DNS label", () => {
    expect(
      execHandshakeSchema.safeParse({
        ...base,
        namespace: "Default",
        target: { tool: "kubectl", pod: "api-7d9f" },
      }).success,
    ).toBe(false);
  });

  it("rejects an empty command", () => {
    expect(parse({ tool: "kubectl", pod: "api-7d9f", command: [] }).success).toBe(false);
  });
});

describe("the kind enum", () => {
  it("covers every arm of the handshake", () => {
    expect([...EXEC_KINDS].toSorted()).toEqual(["ecs", "kube", "ssh", "ssm"]);
    expect(execKindSchema.safeParse("kube").success).toBe(true);
    expect(execKindSchema.safeParse("k8s").success).toBe(false);
  });
});
