import * as crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import { generateEphemeralKey } from "./instanceConnect.ts";

describe("ephemeral keys", () => {
  it("produces an OpenSSH public key", () => {
    const key = generateEphemeralKey();
    expect(key.publicKeyOpenSsh).toMatch(/^ssh-rsa [A-Za-z0-9+/]+=*$/);
    key.scrub();
  });

  it("encodes the wire format OpenSSH expects", () => {
    const key = generateEphemeralKey();
    const blob = Buffer.from(key.publicKeyOpenSsh.split(" ")[1] ?? "", "base64");

    // Three length-prefixed fields: algorithm name, exponent, modulus.
    const nameLength = blob.readUInt32BE(0);
    expect(blob.subarray(4, 4 + nameLength).toString("utf8")).toBe("ssh-rsa");
    const expLength = blob.readUInt32BE(4 + nameLength);
    const modLength = blob.readUInt32BE(4 + nameLength + 4 + expLength);
    // 2048 bits, plus a possible sign-padding byte.
    expect(modLength).toBeGreaterThanOrEqual(256);
    expect(blob.length).toBe(4 + nameLength + 4 + expLength + 4 + modLength);
    key.scrub();
  });

  it("produces a private key ssh2 can actually parse", () => {
    // The regression this guards: an ed25519 PKCS8 PEM is a perfectly valid
    // key that ssh2 refuses with "Unsupported key format".
    const key = generateEphemeralKey();
    expect(key.privateKey.toString("utf8")).toMatch(/^-----BEGIN RSA PRIVATE KEY-----/);
    key.scrub();
  });

  it("is a different key every time", () => {
    const a = generateEphemeralKey();
    const b = generateEphemeralKey();
    expect(a.publicKeyOpenSsh).not.toBe(b.publicKeyOpenSsh);
    a.scrub();
    b.scrub();
  });

  it("hands out a usable private key before it is scrubbed", () => {
    const key = generateEphemeralKey();
    expect(() => crypto.createPrivateKey(key.privateKey)).not.toThrow();
    key.scrub();
  });

  it("zeroes the private key on scrub, so it does not linger in the heap", () => {
    const key = generateEphemeralKey();
    expect(key.privateKey.some((byte) => byte !== 0)).toBe(true);
    key.scrub();
    expect(key.privateKey.every((byte) => byte === 0)).toBe(true);
  });
});
