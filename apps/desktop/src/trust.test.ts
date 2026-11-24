import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { TrustEntry } from "@faws/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ACCEPT,
  chainOf,
  decide,
  ERR_CERT_AUTHORITY_INVALID,
  trustEntriesOf,
  USE_CHROMIUM,
} from "./trust.ts";

/**
 * A private CA with an intermediate, leaves it signed, a second CA nobody
 * trusts, and a self-signed leaf - the shapes a re-signing proxy or an
 * internal endpoint present - built with the openssl CLI.
 */
let dir: string;
const pem: Record<string, string> = {};

function openssl(...args: string[]) {
  execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
}

function makeCa(name: string, subject: string) {
  openssl(
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    `${name}.key`,
    "-out",
    `${name}.pem`,
    "-days",
    "2",
    "-subj",
    `/CN=${subject}`,
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
  );
}

function sign(name: string, issuer: string, subject: string, ext: string, days = "2") {
  openssl(
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    `${name}.key`,
    "-out",
    `${name}.csr`,
    "-subj",
    `/CN=${subject}`,
  );
  fs.writeFileSync(path.join(dir, `${name}.cnf`), ext);
  openssl(
    "x509",
    "-req",
    "-in",
    `${name}.csr`,
    "-CA",
    `${issuer}.pem`,
    "-CAkey",
    `${issuer}.key`,
    "-CAcreateserial",
    "-out",
    `${name}.pem`,
    "-days",
    days,
    "-extfile",
    `${name}.cnf`,
  );
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "faws-desktop-trust-"));
  makeCa("ca", "faws test CA");
  makeCa("rogue", "rogue CA");
  sign(
    "intermediate",
    "ca",
    "faws test intermediate",
    "basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n",
  );
  const leafExt = "subjectAltName=DNS:updates.example.test\n";
  sign("leaf", "ca", "updates.example.test", leafExt);
  sign("viaIntermediate", "intermediate", "updates.example.test", leafExt);
  sign("rogueLeaf", "rogue", "updates.example.test", leafExt);
  openssl(
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "self.key",
    "-out",
    "self.pem",
    "-days",
    "2",
    "-subj",
    "/CN=updates.example.test",
    "-addext",
    "subjectAltName=DNS:updates.example.test",
  );
  for (const name of [
    "ca",
    "rogue",
    "intermediate",
    "leaf",
    "viaIntermediate",
    "rogueLeaf",
    "self",
  ]) {
    pem[name] = fs.readFileSync(path.join(dir, `${name}.pem`), "utf8");
  }
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function entry(name: string, kind: TrustEntry["kind"]): TrustEntry {
  return {
    id: name,
    label: name,
    fingerprintSha256: new X509Certificate(pem[name]!).fingerprint256.toUpperCase(),
    subject: "",
    issuer: "",
    validTo: "",
    kind,
    pem: pem[name]!,
    addedAt: "",
    addedFrom: "imported",
  };
}

const HOST = "updates.example.test";
const untrusted = (chain: string[], hostname = HOST) => ({
  hostname,
  errorCode: ERR_CERT_AUTHORITY_INVALID,
  chain,
});

describe("decide", () => {
  it("leaves a chain Chromium trusts to Chromium", () => {
    expect(decide({ hostname: HOST, errorCode: 0, chain: [] }, []).result).toBe(USE_CHROMIUM);
  });

  it("accepts a leaf signed by a trusted CA, whether or not the CA is presented", () => {
    const trusted = [entry("ca", "ca")];
    expect(decide(untrusted([pem["leaf"]!, pem["ca"]!]), trusted).result).toBe(ACCEPT);
    expect(decide(untrusted([pem["leaf"]!]), trusted).result).toBe(ACCEPT);
  });

  it("walks through an intermediate to a trusted root", () => {
    const trusted = [entry("ca", "ca")];
    const chain = [pem["viaIntermediate"]!, pem["intermediate"]!, pem["ca"]!];
    expect(decide(untrusted(chain), trusted).result).toBe(ACCEPT);
    expect(decide(untrusted(chain.slice(0, 2)), trusted).result).toBe(ACCEPT);
  });

  it("accepts a trusted self-signed leaf", () => {
    expect(decide(untrusted([pem["self"]!]), [entry("self", "self-signed")]).result).toBe(ACCEPT);
  });

  it("refuses a chain from a CA nobody trusted", () => {
    const verdict = decide(untrusted([pem["rogueLeaf"]!, pem["rogue"]!]), [entry("ca", "ca")]);
    expect(verdict.result).toBe(USE_CHROMIUM);
  });

  it("refuses a trusted CA tacked onto a chain it did not sign", () => {
    const chain = [pem["rogueLeaf"]!, pem["rogue"]!, pem["ca"]!];
    expect(decide(untrusted(chain), [entry("ca", "ca")]).result).toBe(USE_CHROMIUM);
  });

  it("refuses a self-signed entry anywhere but the leaf", () => {
    const chain = [pem["leaf"]!, pem["ca"]!];
    expect(decide(untrusted(chain), [entry("ca", "self-signed")]).result).toBe(USE_CHROMIUM);
  });

  it("refuses a name mismatch even from a trusted CA", () => {
    const verdict = decide(untrusted([pem["leaf"]!], "other.example.test"), [entry("ca", "ca")]);
    expect(verdict).toEqual({ result: USE_CHROMIUM, reason: "issued for another name" });
  });

  it("refuses once the chain has expired", () => {
    const later = Date.now() + 5 * 24 * 60 * 60 * 1000;
    const verdict = decide(untrusted([pem["leaf"]!, pem["ca"]!]), [entry("ca", "ca")], later);
    expect(verdict.result).toBe(USE_CHROMIUM);
  });

  it("never overturns a refusal other than an untrusted issuer", () => {
    for (const errorCode of [-200, -201, -206, -207]) {
      const verdict = decide({ hostname: HOST, errorCode, chain: [pem["leaf"]!] }, [
        entry("ca", "ca"),
      ]);
      expect(verdict.result).toBe(USE_CHROMIUM);
    }
  });

  it("refuses an unreadable chain", () => {
    expect(decide(untrusted(["not a certificate"]), [entry("ca", "ca")]).result).toBe(USE_CHROMIUM);
  });
});

describe("chainOf", () => {
  it("flattens Electron's issuer links and stops at a self-referencing root", () => {
    const root: { data: string; issuerCert?: unknown } = { data: "root" };
    root.issuerCert = root;
    expect(chainOf({ data: "leaf", issuerCert: root as { data: string } })).toEqual([
      "leaf",
      "root",
    ]);
  });
});

describe("trustEntriesOf", () => {
  it("reads the trust section and drops unreadable entries", () => {
    const good = entry("ca", "ca");
    expect(trustEntriesOf({ trust: { entries: [good, { id: "broken" }] } })).toEqual([good]);
  });

  it("trusts nothing extra from a file without one", () => {
    expect(trustEntriesOf(null)).toEqual([]);
    expect(trustEntriesOf({ trust: "nonsense" })).toEqual([]);
  });
});
