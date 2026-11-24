/**
 * The app's certificate trust: Node's bundled CAs, optionally the operating
 * system's, and whatever the person has chosen to trust.
 *
 * Installed as Node's default CA set, so every TLS connection that does not
 * name its own CAs - the AWS SDK's, an S3-compatible endpoint's, a webhook -
 * trusts the same things. A connection with its own `caPaths` or pin still
 * layers those on top.
 */
import { createHash, X509Certificate } from "node:crypto";
import * as tls from "node:tls";

import type {
  PresentedCertificate,
  PresentedChain,
  TrustEntry,
  TrustSettings,
} from "@faws/contracts";

/** Refusals a trusted CA or self-signed certificate can fix. */
const FIXABLE = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_UNTRUSTED",
]);

const TIMEOUT_MS = 8000;

/** Makes `trust` the default for every TLS connection from here on. */
export function applyTrust(trust: TrustSettings): void {
  tls.setDefaultCACertificates([
    ...tls.getCACertificates("bundled"),
    ...(trust.useSystemStore ? tls.getCACertificates("system") : []),
    ...trust.entries.map((entry) => entry.pem),
  ]);
}

/**
 * OpenSSL's code for a refusal. Typed as an `Error`, `authorizationError` is
 * in practice the bare code string; both shapes are read.
 */
function tlsErrorCode(error: unknown): string | null {
  if (typeof error === "string") return error;
  if (!(error instanceof Error)) return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") return code;
  return /^[A-Z_]+$/.test(error.message) ? error.message : null;
}

const READABLE: Record<string, string> = {
  SELF_SIGNED_CERT_IN_CHAIN: "The chain ends in a CA this app does not trust.",
  DEPTH_ZERO_SELF_SIGNED_CERT: "The server presents a self-signed certificate.",
  UNABLE_TO_GET_ISSUER_CERT: "The certificate's issuer is not trusted.",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "The certificate's issuer is not trusted.",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "The certificate's issuer is not trusted.",
  CERT_HAS_EXPIRED: "The certificate has expired.",
  ERR_TLS_CERT_ALTNAME_INVALID: "The certificate was issued for a different name.",
};

/** Colon hex, upper case. */
export function fingerprintOf(cert: X509Certificate): string {
  return cert.fingerprint256.toUpperCase();
}

function commonName(dn: string): string {
  return /(?:^|\n)CN=([^\n]+)/.exec(dn)?.[1] ?? "";
}

function oneLine(dn: string): string {
  return dn.split("\n").filter(Boolean).join(", ");
}

/**
 * Connects without verifying, to show what a host presents, then reports
 * whether a verifying connection would succeed. Nothing is trusted by this.
 */
export async function inspectChain(
  host: string,
  port: number,
  trusted: ReadonlyArray<TrustEntry>,
): Promise<{ summary: PresentedChain; certificates: X509Certificate[] }> {
  const known = new Set(trusted.map((entry) => entry.fingerprintSha256));

  const presented = await new Promise<{
    certificates: X509Certificate[];
    authorized: boolean;
    error: unknown;
  }>((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false }, () => {
      const chain: X509Certificate[] = [];
      const seen = new Set<string>();
      let current: tls.DetailedPeerCertificate | undefined = socket.getPeerCertificate(true);
      while (current?.raw && !seen.has(current.fingerprint256)) {
        seen.add(current.fingerprint256);
        chain.push(new X509Certificate(current.raw));
        current = current.issuerCertificate;
      }
      resolve({
        certificates: chain,
        authorized: socket.authorized,
        error: socket.authorizationError ?? null,
      });
      socket.destroy();
    });
    socket.setTimeout(TIMEOUT_MS, () =>
      socket.destroy(new Error(`No answer from ${host}:${port} within ${TIMEOUT_MS / 1000}s.`)),
    );
    socket.on("error", reject);
  });

  const now = Date.now();
  const leaf = presented.certificates[0];
  const hostMatches = leaf
    ? leaf.checkHost(host) !== undefined || leaf.checkIP(host) !== undefined
    : false;
  const expired = presented.certificates.some((cert) => Date.parse(cert.validTo) < now);
  const errorCode = tlsErrorCode(presented.error);

  const summary: PresentedChain = {
    host,
    port,
    authorized: presented.authorized,
    errorCode,
    errorMessage: errorCode
      ? (READABLE[errorCode] ?? errorCode)
      : presented.error instanceof Error
        ? presented.error.message
        : null,
    fixableByTrust:
      !presented.authorized &&
      !expired &&
      hostMatches &&
      errorCode !== null &&
      FIXABLE.has(errorCode),
    chain: presented.certificates.map((cert): PresentedCertificate => ({
      subject: oneLine(cert.subject),
      issuer: oneLine(cert.issuer),
      commonName: commonName(cert.subject),
      subjectAltName: cert.subjectAltName ?? "",
      validFrom: cert.validFrom,
      validTo: cert.validTo,
      fingerprintSha256: fingerprintOf(cert),
      isCA: cert.ca,
      selfSigned: cert.subject === cert.issuer,
      expired: Date.parse(cert.validTo) < now,
      trusted: known.has(fingerprintOf(cert)),
    })),
  };
  return { summary, certificates: presented.certificates };
}

/**
 * A trust entry for one certificate, or null when trusting it would not mean
 * anything: an end-entity certificate signed by someone else vouches for
 * nothing on its own, so only CAs and self-signed certificates are taken.
 */
export function entryFor(cert: X509Certificate, addedFrom: string, label = ""): TrustEntry | null {
  const selfSigned = cert.subject === cert.issuer;
  if (!cert.ca && !selfSigned) return null;
  return {
    id: createHash("sha256").update(cert.raw).digest("hex").slice(0, 16),
    label: label || commonName(cert.subject) || oneLine(cert.subject),
    fingerprintSha256: fingerprintOf(cert),
    subject: oneLine(cert.subject),
    issuer: oneLine(cert.issuer),
    validTo: cert.validTo,
    kind: cert.ca ? "ca" : "self-signed",
    pem: cert.toString(),
    addedAt: new Date().toISOString(),
    addedFrom,
  };
}

/** Every certificate in a PEM bundle; throws on text that holds none. */
export function parsePemBundle(pem: string): X509Certificate[] {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  if (blocks.length === 0)
    throw new Error(
      "No certificate found. Paste PEM text, beginning with -----BEGIN CERTIFICATE-----.",
    );
  return blocks.map((block) => new X509Certificate(block));
}
