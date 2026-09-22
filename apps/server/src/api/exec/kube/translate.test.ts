import { describe, expect, it } from "vitest";

import { ExecSessionError } from "../errors.ts";
import { classifyKubeOutput, translateKubeError } from "./translate.ts";

function code(text: string): string | null {
  return classifyKubeOutput(text, 1)?.code ?? null;
}

describe("classifying what the child said", () => {
  it("recognises an unreachable API server", () => {
    expect(code("Unable to connect to the server: dial tcp 10.0.0.1:443: i/o timeout")).toBe(
      "KubeApiUnreachable",
    );
    expect(code('error: couldn\'t get current server API group list: Get "https://x": EOF')).toBe(
      "KubeApiUnreachable",
    );
  });

  it("recognises credentials the cluster would not take", () => {
    expect(code("error: You must be logged in to the server (Unauthorized)")).toBe(
      "KubeAuthFailed",
    );
  });

  it("recognises an exec credential plugin that failed", () => {
    expect(
      code("Unable to connect to the server: getting credentials: exec: executable aws failed"),
    ).toBe("KubeAuthFailed");
  });

  it("tells forbidden apart from unauthenticated", () => {
    expect(
      code(
        'Error from server (Forbidden): pods "api-7d9f" is forbidden: User "dev" cannot create resource "pods/exec"',
      ),
    ).toBe("KubeForbidden");
  });

  it("recognises a pod that has been replaced", () => {
    expect(code('Error from server (NotFound): pods "api-7d9f" not found')).toBe("KubePodNotFound");
  });

  it("recognises a container that is not in the pod", () => {
    expect(code('container named "sidecar" is not found in pod api-7d9f')).toBe(
      "KubeContainerNotFound",
    );
  });

  it("recognises a virtual machine that is not up", () => {
    expect(code("VirtualMachineInstance builder is not running")).toBe("KubeVmNotRunning");
  });

  it("recognises a cluster with no KubeVirt on it", () => {
    expect(code('error: the server doesn\'t have a resource type "virtualmachineinstances"')).toBe(
      "KubeVirtUnavailable",
    );
  });

  it("recognises a context that has gone", () => {
    expect(code('error: context "prod" does not exist')).toBe("KubeContextUnknown");
  });

  it("recognises a kubeconfig that could not be read", () => {
    expect(code("error loading config file /home/dev/.kube/config: permission denied")).toBe(
      "KubeconfigMissing",
    );
  });

  it("says nothing about output it does not recognise", () => {
    // The fallback path: an unmatched non-zero exit keeps the behaviour every
    // other driver has, with the output already on screen doing the explaining.
    expect(classifyKubeOutput("logout\r\n", 1)).toBeNull();
  });

  it("never classifies a clean exit", () => {
    // Shells print all sorts of things. None of it is a diagnostic when the
    // command succeeded.
    expect(classifyKubeOutput('pods "api" not found', 0)).toBeNull();
    expect(classifyKubeOutput("Unable to connect to the server", null)).toBeNull();
  });
});

describe("translating a fault we caught", () => {
  it("keeps a coded error as it is", () => {
    const original = new ExecSessionError("KubeForbidden", "no");
    expect(translateKubeError(original)).toBe(original);
  });

  it("reads a failed spawn as a missing binary", () => {
    const err = Object.assign(new Error("spawn kubectl ENOENT"), { code: "ENOENT" });
    expect(translateKubeError(err).code).toBe("KubeBinaryMissing");
  });

  it("classifies a refusal by what the command printed", () => {
    expect(
      translateKubeError(new Error('Error from server (NotFound): pods "api" not found')).code,
    ).toBe("KubePodNotFound");
  });

  it("falls back to Internal with the message intact", () => {
    const translated = translateKubeError(new Error("something else entirely"));
    expect(translated.code).toBe("Internal");
    expect(translated.message).toBe("something else entirely");
  });
});
