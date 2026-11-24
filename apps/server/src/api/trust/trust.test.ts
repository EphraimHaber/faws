import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tls from "node:tls";

import { DEFAULT_SETTINGS } from "@faws/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyTrust, entryFor, inspectChain, parsePemBundle } from "./trust.ts";

/**
 * A private CA, a server certificate it signed for "localhost", and a TLS
 * server presenting both - the shape of an internal MinIO or a re-signing
 * proxy, built with the openssl CLI so the test needs no fixtures on disk.
 */
let dir: string;
let server: tls.Server;
let port: number;
let caPem: string;

function openssl(...args: string[]) {
  execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "faws-trust-"));
  openssl(
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "ca.key",
    "-out",
    "ca.pem",
    "-days",
    "2",
    "-subj",
    "/CN=faws test CA",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
  );
  openssl(
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "leaf.key",
    "-out",
    "leaf.csr",
    "-subj",
    "/CN=localhost",
  );
  fs.writeFileSync(path.join(dir, "ext.cnf"), "subjectAltName=DNS:localhost\n");
  openssl(
    "x509",
    "-req",
    "-in",
    "leaf.csr",
    "-CA",
    "ca.pem",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-out",
    "leaf.pem",
    "-days",
    "2",
    "-extfile",
    "ext.cnf",
  );
  caPem = fs.readFileSync(path.join(dir, "ca.pem"), "utf8");

  server = tls.createServer({
    key: fs.readFileSync(path.join(dir, "leaf.key")),
    cert: fs.readFileSync(path.join(dir, "leaf.pem"), "utf8") + caPem,
  });
  server.on("secureConnection", (socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(() => {
  applyTrust(DEFAULT_SETTINGS.trust);
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("trust", () => {
  it("shows a chain from a private CA as refused, and fixable by trusting the CA", async () => {
    applyTrust(DEFAULT_SETTINGS.trust);
    const { summary } = await inspectChain("localhost", port, []);
    expect(summary.authorized).toBe(false);
    expect(summary.errorCode).toBe("SELF_SIGNED_CERT_IN_CHAIN");
    expect(summary.fixableByTrust).toBe(true);
    expect(summary.chain.map((cert) => [cert.commonName, cert.isCA])).toEqual([
      ["localhost", false],
      ["faws test CA", true],
    ]);
  });

  it("accepts the host once its CA is trusted, and refuses it again once removed", async () => {
    const { certificates } = await inspectChain("localhost", port, []);
    const ca = entryFor(certificates[1]!, `localhost:${port}`);
    expect(ca?.kind).toBe("ca");
    expect(entryFor(certificates[0]!, "x")).toBeNull();

    applyTrust({ useSystemStore: false, entries: [ca!] });
    const trusted = await inspectChain("localhost", port, [ca!]);
    expect(trusted.summary.authorized).toBe(true);
    expect(trusted.summary.chain[1]?.trusted).toBe(true);

    applyTrust(DEFAULT_SETTINGS.trust);
    expect((await inspectChain("localhost", port, [])).summary.authorized).toBe(false);
  });

  it("does not offer trust as the fix for a certificate issued to another name", async () => {
    const { summary } = await inspectChain("127.0.0.1", port, []);
    expect(summary.authorized).toBe(false);
    expect(summary.fixableByTrust).toBe(false);
  });

  it("reads every certificate from a pasted bundle, and refuses text with none", () => {
    expect(parsePemBundle(`${caPem}\n${caPem}`)).toHaveLength(2);
    expect(() => parsePemBundle("not a certificate")).toThrow("No certificate found");
  });
});
