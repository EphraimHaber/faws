/** OpenSSL's codes for "this chain was refused", as node reports them. */
const TRUST_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_TLS_FINGERPRINT_MISMATCH",
]);

/** The certificate complaint behind an error, wherever in the chain it is. */
export function trustReason(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; current instanceof Error && depth < 8; depth += 1) {
    const code = (current as { code?: string }).code;
    if (code && TRUST_CODES.has(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}
