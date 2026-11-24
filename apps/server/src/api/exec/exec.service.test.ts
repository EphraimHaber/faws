import type { ExecHandshakeAuth } from "@faws/contracts";
import { setProviderGate } from "@faws/kit/server";
import { afterEach, describe, expect, it } from "vitest";

import { registerSshRoute, sshProvider } from "./drivers/ssh.driver.ts";
import { chooseDriver, registerExecDriver, type ExecDriverFactory } from "./exec.service.ts";

const factory: ExecDriverFactory = async () => ({
  write: () => {},
  resize: () => {},
  close: () => {},
});

const ssm = {
  kind: "ssm",
  sessionId: "00000000-0000-4000-8000-000000000001",
  profile: "default",
  region: "eu-west-1",
  instanceId: "i-0abc",
  cols: 80,
  rows: 24,
} as ExecHandshakeAuth;

function gate(off: ReadonlyArray<string>): void {
  setProviderGate({
    isEnabled: (id) => !off.includes(id),
    label: (id) => (id === "aws" ? "AWS" : id),
  });
}

afterEach(() => gate([]));

describe("chooseDriver", () => {
  it("opens a contribution while its provider is on", () => {
    registerExecDriver("ssm", factory, "aws");
    gate([]);
    expect(chooseDriver(ssm)).toEqual({ ok: true, factory });
  });

  it("refuses a contribution while its provider is switched off", () => {
    registerExecDriver("ssm", factory, "aws");
    gate(["aws"]);
    expect(chooseDriver(ssm)).toEqual({
      ok: false,
      code: "ProviderDisabled",
      userMessage: "AWS is switched off. Turn it on in Settings to use it.",
    });
  });

  it("refuses SSH over a provider's route, and only that, while the provider is off", () => {
    registerSshRoute("aws", {
      via: "ssm-tunnel",
      open: () => Promise.reject(new Error("never opened")),
    });
    registerExecDriver("ssh", factory, sshProvider);
    gate(["aws"]);

    const ssh = (transport: object) =>
      ({ ...ssm, kind: "ssh", transport }) as unknown as ExecHandshakeAuth;
    const tunnelled = chooseDriver(
      ssh({ via: "ssm-tunnel", profile: "default", region: "eu-west-1", instanceId: "i-0abc" }),
    );
    expect(tunnelled).toMatchObject({ ok: false, code: "ProviderDisabled" });
    expect(chooseDriver(ssh({ via: "direct", host: "bastion" })).ok).toBe(true);
  });

  it("keeps the host's own drivers open whatever is switched off", () => {
    registerExecDriver("ssm", factory);
    gate(["aws", "kubernetes"]);
    expect(chooseDriver(ssm).ok).toBe(true);
  });
});
