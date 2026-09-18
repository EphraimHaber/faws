import { describe, expect, it } from "vitest";

import { listSshHosts, resolveSshHost } from "./sshConfig.ts";

const CONFIG = `
Host bastion
  HostName bastion.example.com
  User ubuntu
  Port 2222
  IdentityFile ~/.ssh/id_bastion

Host db
  HostName 10.0.1.5
  ProxyJump bastion
  ConnectTimeout 15
  ServerAliveInterval 30

Host legacy
  HostName legacy.example.com
  ProxyCommand nc %h %p

Host runner
  HostName runner.example.com
  LocalCommand echo hi
  PermitLocalCommand yes

Host forwarder
  HostName forwarder.example.com
  ForwardAgent yes

Host *.internal
  User svc
`;

describe("resolving", () => {
  it("applies HostName, User and Port", () => {
    const resolved = resolveSshHost(CONFIG, "bastion");
    expect(resolved.hostName).toBe("bastion.example.com");
    expect(resolved.user).toBe("ubuntu");
    expect(resolved.port).toBe(2222);
  });

  it("expands ~ in IdentityFile", () => {
    const [identity] = resolveSshHost(CONFIG, "bastion").identityFiles;
    expect(identity).not.toContain("~");
    expect(identity).toMatch(/\.ssh\/id_bastion$/);
  });

  it("reads ProxyJump as a chain", () => {
    expect(resolveSshHost(CONFIG, "db").proxyJump).toEqual(["bastion"]);
  });

  it("converts timeouts to milliseconds", () => {
    const resolved = resolveSshHost(CONFIG, "db");
    expect(resolved.connectTimeoutMs).toBe(15_000);
    expect(resolved.keepaliveIntervalMs).toBe(30_000);
  });

  it("applies a wildcard block", () => {
    expect(resolveSshHost(CONFIG, "anything.internal").user).toBe("svc");
  });

  it("falls back to the host itself when there is no entry", () => {
    const resolved = resolveSshHost(CONFIG, "unlisted.example.com");
    expect(resolved.hostName).toBe("unlisted.example.com");
    expect(resolved.user).toBe(null);
    expect(resolved.port).toBe(null);
  });

  it("survives a config it cannot parse, and says so", () => {
    const resolved = resolveSshHost("Host {{{\n  bad", "anything");
    expect(resolved.hostName).toBe("anything");
    // Either the parser coped or it reported; what must not happen is a throw.
    expect(Array.isArray(resolved.rejected)).toBe(true);
  });
});

describe("rejecting rather than ignoring", () => {
  it("refuses ProxyCommand by name", () => {
    const { rejected } = resolveSshHost(CONFIG, "legacy");
    const entry = rejected.find((item) => item.directive.toLowerCase() === "proxycommand");
    expect(entry).toBeDefined();
    expect(entry?.reason).toMatch(/ProxyJump/);
  });

  it("refuses directives that run commands", () => {
    const names = resolveSshHost(CONFIG, "runner").rejected.map((item) =>
      item.directive.toLowerCase(),
    );
    expect(names).toContain("localcommand");
  });

  it("reports unsupported agent forwarding", () => {
    const names = resolveSshHost(CONFIG, "forwarder").rejected.map((item) =>
      item.directive.toLowerCase(),
    );
    expect(names).toContain("forwardagent");
  });

  it("says nothing about a host with no problem directives", () => {
    expect(resolveSshHost(CONFIG, "bastion").rejected).toEqual([]);
  });
});

describe("listing", () => {
  it("offers concrete aliases", () => {
    const hosts = listSshHosts(CONFIG).map((entry) => entry.host);
    expect(hosts).toContain("bastion");
    expect(hosts).toContain("db");
  });

  it("leaves out patterns, which are not connectable", () => {
    expect(listSshHosts(CONFIG).map((entry) => entry.host)).not.toContain("*.internal");
  });

  it("carries the resolved HostName for display", () => {
    const bastion = listSshHosts(CONFIG).find((entry) => entry.host === "bastion");
    expect(bastion?.hostName).toBe("bastion.example.com");
  });
});
