import { describe, expect, it } from "vitest";

import { parseJumpTarget } from "./connect.ts";

describe("parseJumpTarget", () => {
  it("takes a bare hostname", () => {
    expect(parseJumpTarget("bastion")).toEqual({ host: "bastion" });
  });

  it("takes a login", () => {
    expect(parseJumpTarget("ubuntu@bastion")).toEqual({ host: "bastion", user: "ubuntu" });
  });

  it("takes a port, which a jump host frequently is not on 22 for", () => {
    expect(parseJumpTarget("bastion:2222")).toEqual({ host: "bastion", port: 2222 });
  });

  it("takes both", () => {
    expect(parseJumpTarget("ec2-user@10.0.0.5:2222")).toEqual({
      host: "10.0.0.5",
      user: "ec2-user",
      port: 2222,
    });
  });

  it("trims surrounding space", () => {
    expect(parseJumpTarget("  bastion  ")).toEqual({ host: "bastion" });
  });

  it("keeps a bare IPv6 address whole, since its colons are not a port", () => {
    expect(parseJumpTarget("fd00::1")).toEqual({ host: "fd00::1" });
  });

  it("reads a bracketed IPv6 address with a port", () => {
    expect(parseJumpTarget("[fd00::1]:2222")).toEqual({ host: "fd00::1", port: 2222 });
  });

  it("reads a bracketed IPv6 address without one", () => {
    expect(parseJumpTarget("[fd00::1]")).toEqual({ host: "fd00::1" });
  });

  it("leaves a nonsense port as part of the hostname rather than guessing", () => {
    expect(parseJumpTarget("bastion:not-a-port")).toEqual({ host: "bastion:not-a-port" });
    expect(parseJumpTarget("bastion:99999")).toEqual({ host: "bastion:99999" });
  });

  it("splits on the last @, so a username containing one survives", () => {
    expect(parseJumpTarget("first@second@host")).toEqual({
      host: "host",
      user: "first@second",
    });
  });
});
