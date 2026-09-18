import * as crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import { fingerprint, hostPattern, knownHostsLine, verifyHostKey } from "./knownHosts.ts";

const KEY = "AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyMaterialHere0000000000000";
const OTHER_KEY = "AAAAC3NzaC1lZDI1NTE5AAAAIDifferentKeyMaterial000000000000000";
const TYPE = "ssh-ed25519";

function check(lines: string[], host = "box.internal", port = 22, key = KEY) {
  return verifyHostKey(lines, "/tmp/known_hosts", host, port, TYPE, key);
}

/** The `|1|salt|hash` form written when HashKnownHosts is on. */
function hashed(host: string): string {
  const salt = crypto.randomBytes(20);
  const mac = crypto.createHmac("sha1", salt);
  mac.update(host);
  return `|1|${salt.toString("base64")}|${mac.digest("base64")}`;
}

describe("matching", () => {
  it("trusts a recorded key", () => {
    expect(check([`box.internal ${TYPE} ${KEY}`])).toEqual({ outcome: "trusted" });
  });

  it("reports an unknown host", () => {
    expect(check([`other.internal ${TYPE} ${KEY}`])).toEqual({ outcome: "unknown" });
  });

  it("treats an empty file as first contact", () => {
    expect(check([])).toEqual({ outcome: "unknown" });
  });

  it("ignores comments and blank lines", () => {
    expect(check(["", "# a comment", "   ", `box.internal ${TYPE} ${KEY}`])).toEqual({
      outcome: "trusted",
    });
  });

  it("matches one host among several on a line", () => {
    expect(check([`a.internal,box.internal,c.internal ${TYPE} ${KEY}`])).toEqual({
      outcome: "trusted",
    });
  });

  it("matches a wildcard pattern", () => {
    expect(check([`*.internal ${TYPE} ${KEY}`])).toEqual({ outcome: "trusted" });
  });
});

describe("non-default ports", () => {
  it("records and matches the bracketed form", () => {
    expect(hostPattern("box.internal", 2222)).toBe("[box.internal]:2222");
    expect(check([`[box.internal]:2222 ${TYPE} ${KEY}`], "box.internal", 2222)).toEqual({
      outcome: "trusted",
    });
  });

  it("does not bracket the default port, matching what ssh writes", () => {
    expect(hostPattern("box.internal", 22)).toBe("box.internal");
  });
});

describe("hashed entries", () => {
  it("matches a hashed hostname", () => {
    expect(check([`${hashed("box.internal")} ${TYPE} ${KEY}`])).toEqual({ outcome: "trusted" });
  });

  it("does not match a hash for a different host", () => {
    expect(check([`${hashed("elsewhere.internal")} ${TYPE} ${KEY}`])).toEqual({
      outcome: "unknown",
    });
  });

  it("detects a changed key behind a hashed hostname", () => {
    const verdict = check([`${hashed("box.internal")} ${TYPE} ${OTHER_KEY}`]);
    expect(verdict.outcome).toBe("changed");
  });
});

describe("refusing rather than trusting", () => {
  it("reports a changed key with the line to fix", () => {
    const verdict = check([`# header`, `box.internal ${TYPE} ${OTHER_KEY}`]);
    expect(verdict).toEqual({ outcome: "changed", file: "/tmp/known_hosts", line: 2 });
  });

  it("fails closed on a structurally broken line", () => {
    expect(check(["box.internal"]).outcome).toBe("unparseable");
  });

  it("fails closed when this host's own key is corrupt", () => {
    // The dangerous case: the line is about us, so falling through to "unknown"
    // would offer to trust a host that already has a key on record.
    expect(check([`box.internal ${TYPE} not-base64!!!`]).outcome).toBe("unparseable");
  });

  it("ignores a well-formed line for a different host", () => {
    // One stale entry elsewhere in the file must not break every connection.
    expect(check([`other.internal ${TYPE} ${OTHER_KEY}`, `box.internal ${TYPE} ${KEY}`])).toEqual({
      outcome: "trusted",
    });
  });

  it("fails closed on an unrecognised marker", () => {
    expect(check([`@nonsense box.internal ${TYPE} ${KEY}`]).outcome).toBe("unparseable");
  });

  it("never returns trusted when this host's line cannot be read", () => {
    // The reference implementation trusted whatever its key parser threw on.
    // This is the regression test for that.
    const verdict = check([`box.internal ${TYPE} @@@corrupt@@@`, `box.internal ${TYPE} ${KEY}`]);
    expect(verdict.outcome).toBe("unparseable");
  });

  it("refuses a revoked key", () => {
    expect(check([`@revoked box.internal ${TYPE} ${KEY}`])).toEqual({ outcome: "revoked" });
  });

  it("does not treat a cert-authority line as the host's own key", () => {
    expect(check([`@cert-authority *.internal ${TYPE} ${OTHER_KEY}`])).toEqual({
      outcome: "unknown",
    });
  });
});

describe("what gets written", () => {
  it("builds the line ssh would write", () => {
    expect(knownHostsLine("box.internal", 22, TYPE, KEY)).toBe(`box.internal ${TYPE} ${KEY}`);
    expect(knownHostsLine("box.internal", 2222, TYPE, KEY)).toBe(
      `[box.internal]:2222 ${TYPE} ${KEY}`,
    );
  });

  it("round-trips: a written line is then trusted", () => {
    const line = knownHostsLine("box.internal", 2222, TYPE, KEY);
    expect(check([line], "box.internal", 2222)).toEqual({ outcome: "trusted" });
  });
});

describe("fingerprint", () => {
  it("is the SHA256 form people compare", () => {
    const value = fingerprint(KEY);
    expect(value).toMatch(/^SHA256:[A-Za-z0-9+/]+$/);
    expect(value).not.toMatch(/=$/);
  });

  it("differs for a different key", () => {
    expect(fingerprint(KEY)).not.toBe(fingerprint(OTHER_KEY));
  });
});
