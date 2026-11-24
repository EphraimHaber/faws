/**
 * What a host's certificate looks like from here, and which of this app's
 * trusted CAs vouch for it.
 *
 * `oc` and `kubectl` are Go programs: they ignore Node's trust store, so a CA
 * the person trusted in faws means nothing to them until it is written into
 * the cluster's kubeconfig entry. `anchorsFor` finds exactly those CAs.
 */
import { X509Certificate } from "node:crypto";
import { isIP } from "node:net";
import * as tls from "node:tls";

import type { KubeTlsVerdict } from "@faws/contracts";

const TIMEOUT_MS = 8000;

export interface PresentedTls {
  readonly verdict: KubeTlsVerdict;
  /** Leaf first, as the server sent it. */
  readonly chain: readonly X509Certificate[];
}

/** Connects without verifying, to see the chain, and reports whether verifying would pass. */
export function inspectTls(host: string, port: number): Promise<PresentedTls> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host, port, ...(isIP(host) ? {} : { servername: host }), rejectUnauthorized: false },
      () => {
        const chain: X509Certificate[] = [];
        const seen = new Set<string>();
        let current: tls.DetailedPeerCertificate | undefined = socket.getPeerCertificate(true);
        while (current?.raw && !seen.has(current.fingerprint256)) {
          seen.add(current.fingerprint256);
          chain.push(new X509Certificate(current.raw));
          current = current.issuerCertificate;
        }
        const leaf = chain[0];
        const nameMatches = leaf
          ? leaf.checkHost(host) !== undefined || leaf.checkIP(host) !== undefined
          : false;
        const chainError = socket.authorizationError as unknown;
        const errorCode =
          typeof chainError === "string"
            ? chainError
            : chainError instanceof Error
              ? ((chainError as { code?: string }).code ?? chainError.message)
              : nameMatches
                ? null
                : "ERR_TLS_CERT_ALTNAME_INVALID";
        resolve({
          verdict: {
            host,
            port,
            authorized: socket.authorized && nameMatches,
            errorCode,
            errorMessage: errorCode ? describe(errorCode) : null,
          },
          chain,
        });
        socket.destroy();
      },
    );
    socket.setTimeout(TIMEOUT_MS, () =>
      socket.destroy(new Error(`No answer from ${host}:${port} within ${TIMEOUT_MS / 1000}s.`)),
    );
    socket.on("error", reject);
  });
}

function describe(code: string): string {
  switch (code) {
    case "SELF_SIGNED_CERT_IN_CHAIN":
      return "The chain ends in a CA this app does not trust.";
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
      return "The server presents a self-signed certificate.";
    case "UNABLE_TO_GET_ISSUER_CERT":
    case "UNABLE_TO_GET_ISSUER_CERT_LOCALLY":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
      return "The certificate's issuer is not trusted.";
    case "CERT_HAS_EXPIRED":
      return "The certificate has expired.";
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return "The certificate was issued for a different name.";
    default:
      return code;
  }
}

/** The PEMs trusted in this app beyond Node's bundled roots and the system store. */
export function appTrustedCAs(): string[] {
  const builtIn = new Set(
    [...tls.getCACertificates("bundled"), ...safeSystem()].map(fingerprintOf),
  );
  return tls
    .getCACertificates("default")
    .filter((pem) => !builtIn.has(fingerprintOf(pem)))
    .map((pem) => pem.trim());
}

function fingerprintOf(pem: string): string {
  try {
    return new X509Certificate(pem).fingerprint256;
  } catch {
    return pem.trim();
  }
}

function safeSystem(): string[] {
  try {
    return tls.getCACertificates("system");
  } catch {
    return [];
  }
}

/**
 * The CAs among `trusted` that anchor `chain`: one that appears in it, or
 * one that issued its topmost certificate. Empty when none of them do, in
 * which case Go's own roots are what the chain relies on.
 */
export function anchorsFor(
  chain: readonly X509Certificate[],
  trusted: readonly string[],
): string[] {
  const top = chain.at(-1);
  if (!top) return [];
  const fingerprints = new Set(chain.map((cert) => cert.fingerprint256));
  const anchors: string[] = [];
  for (const pem of trusted) {
    let ca: X509Certificate;
    try {
      ca = new X509Certificate(pem);
    } catch {
      continue;
    }
    const issuedTop = top.checkIssued(ca) && top.verify(ca.publicKey);
    if (fingerprints.has(ca.fingerprint256) || issuedTop) anchors.push(ca.toString());
  }
  return anchors;
}
