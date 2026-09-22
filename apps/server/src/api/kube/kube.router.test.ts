import { describe, expect, it } from "vitest";

import { kubeRouter } from "./kube.router.ts";

/**
 * The router takes its names from the same schemas the shell handshake does,
 * so a value refused at one door is refused at the other. These inputs never
 * reach a kubeconfig or a spawn: they are rejected while the input is parsed.
 */
const caller = kubeRouter.createCaller({});

describe("kube router input", () => {
  it("refuses a context that would read as a flag", async () => {
    await expect(caller.pods({ context: "-x", namespace: "payments" })).rejects.toThrow(
      /cannot start with -/,
    );
    await expect(caller.namespaces({ context: "--kubeconfig=/etc/shadow" })).rejects.toThrow(
      /cannot start with -/,
    );
  });

  it("refuses a namespace that is not a Kubernetes name", async () => {
    await expect(caller.virtualMachines({ context: "prod", namespace: "-n" })).rejects.toThrow(
      /Not a Kubernetes name/,
    );
  });

  it("refuses a diagnostics context that would read as a flag", async () => {
    await expect(caller.diagnostics({ context: "-x" })).rejects.toThrow(/cannot start with -/);
  });
});
