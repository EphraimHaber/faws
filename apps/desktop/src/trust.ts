/**
 * Whether the main process's network stack accepts a certificate Chromium
 * refused, judged against the app's own trust store (`settings.trust`).
 *
 * The server installs that store as Node's default CA set; Chromium (and so
 * the updater, which downloads through `net`) knows nothing of it. This module
 * closes the gap without loosening anything else: only an untrusted-issuer
 * refusal can be overturned, and only when the presented chain really is
 * signed by, or is, a certificate the person trusted. A name mismatch, an
 * expired certificate, a revoked one or a broken signature stays refused.
 *
 * Pure: no Electron, no disk. `main.ts` feeds it Electron's request and the
 * entries read from the settings file.
 */
import { X509Certificate } from "node:crypto";
import { isIP } from "node:net";

import { trustSettingsSchema, type TrustEntry } from "@faws/contracts";

/** Chromium's `net::ERR_CERT_AUTHORITY_INVALID`: the issuer is not trusted. */
export const ERR_CERT_AUTHORITY_INVALID = -202;

/** What `setCertificateVerifyProc`'s callback takes: 0 accepts, -3 keeps Chromium's verdict. */
export const ACCEPT = 0;
export const USE_CHROMIUM = -3;

/** The longest chain walked; real ones are three or four deep. */
const MAX_DEPTH = 10;

/** The shape of Electron's `Certificate` this module reads: PEM plus its issuer. */
export interface PresentedCertificateLike {
  readonly data: string;
  readonly issuerCert?: PresentedCertificateLike | null;
}

export interface VerifyRequest {
  readonly hostname: string;
  /** Chromium's own net error for the chain, 0 when it trusts it. */
  readonly errorCode: number;
  /** Presented chain, leaf first, as PEM. */
  readonly chain: ReadonlyArray<string>;
}

export type Verdict =
  | { readonly result: typeof USE_CHROMIUM; readonly reason: string }
  | { readonly result: typeof ACCEPT; readonly reason: string };

/** Electron's nested `issuerCert` links as a flat leaf-first PEM list. */
export function chainOf(certificate: PresentedCertificateLike): string[] {
  const chain: string[] = [];
  let current: PresentedCertificateLike | null | undefined = certificate;
  while (current?.data && chain.length < MAX_DEPTH && !chain.includes(current.data)) {
    chain.push(current.data);
    current = current.issuerCert;
  }
  return chain;
}

/** The `trust` section of a parsed settings file; an unreadable one trusts nothing extra. */
export function trustEntriesOf(settings: unknown): TrustEntry[] {
  const section =
    typeof settings === "object" && settings !== null
      ? (settings as Record<string, unknown>)["trust"]
      : undefined;
  const parsed = trustSettingsSchema.safeParse(section ?? {});
  return parsed.success ? parsed.data.entries : [];
}

function parse(pem: string): X509Certificate | null {
  try {
    return new X509Certificate(pem);
  } catch {
    return null;
  }
}

function isCurrent(cert: X509Certificate, now: number): boolean {
  return Date.parse(cert.validFrom) <= now && now <= Date.parse(cert.validTo);
}

function signedBy(cert: X509Certificate, issuer: X509Certificate): boolean {
  try {
    return cert.checkIssued(issuer) && cert.verify(issuer.publicKey);
  } catch {
    return false;
  }
}

function matchesHost(leaf: X509Certificate, hostname: string): boolean {
  const host = hostname.replace(/^\[(.*)\]$/, "$1");
  try {
    return isIP(host) ? leaf.checkIP(host) !== undefined : leaf.checkHost(host) !== undefined;
  } catch {
    return false;
  }
}

/**
 * The verdict for one TLS handshake.
 *
 * Accepts only when all of these hold: Chromium refused for an untrusted
 * issuer and nothing else it reports, the leaf names `hostname`, every
 * certificate on the path is within its validity, each one is signed by the
 * next, and the path ends at a trusted entry - the leaf itself, or a trusted
 * CA that signed a certificate on it.
 */
export function decide(
  request: VerifyRequest,
  trusted: ReadonlyArray<TrustEntry>,
  now: number = Date.now(),
): Verdict {
  if (request.errorCode === 0) return { result: USE_CHROMIUM, reason: "Chromium trusts it" };
  if (request.errorCode !== ERR_CERT_AUTHORITY_INVALID)
    return { result: USE_CHROMIUM, reason: "refused for something trust cannot fix" };
  if (trusted.length === 0) return { result: USE_CHROMIUM, reason: "nothing extra is trusted" };

  const chain = request.chain.slice(0, MAX_DEPTH).map(parse);
  if (chain.length === 0 || chain.some((cert) => cert === null))
    return { result: USE_CHROMIUM, reason: "unreadable chain" };
  const certs = chain as X509Certificate[];
  const leaf = certs[0]!;

  // Chromium reports the issuer before a name mismatch or an expiry, so both
  // are checked here rather than read from its error code.
  if (!matchesHost(leaf, request.hostname))
    return { result: USE_CHROMIUM, reason: "issued for another name" };

  const byFingerprint = new Map(trusted.map((entry) => [entry.fingerprintSha256, entry]));
  const anchors = trusted
    .filter((entry) => entry.kind === "ca")
    .map((entry) => parse(entry.pem))
    .filter((cert): cert is X509Certificate => cert !== null && isCurrent(cert, now));

  for (let index = 0; index < certs.length; index += 1) {
    const cert = certs[index]!;
    if (!isCurrent(cert, now)) return { result: USE_CHROMIUM, reason: "expired or not yet valid" };

    const entry = byFingerprint.get(cert.fingerprint256.toUpperCase());
    // A self-signed entry vouches for the leaf only; a CA entry for whatever
    // it signed, which the previous step already checked.
    if (entry && (entry.kind === "ca" || index === 0))
      return { result: ACCEPT, reason: `presented certificate is trusted (${entry.label})` };

    if (anchors.some((anchor) => signedBy(cert, anchor)))
      return { result: ACCEPT, reason: "signed by a trusted CA" };

    const next = certs[index + 1];
    if (!next || !next.ca || !signedBy(cert, next))
      return { result: USE_CHROMIUM, reason: "chain does not reach a trusted certificate" };
  }
  return { result: USE_CHROMIUM, reason: "chain does not reach a trusted certificate" };
}
