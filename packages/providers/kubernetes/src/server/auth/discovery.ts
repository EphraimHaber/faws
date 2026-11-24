/**
 * Whether an API server is OpenShift, and where its OAuth server is.
 *
 * OpenShift publishes RFC 8414 metadata at a fixed path on the API server
 * itself, unauthenticated; a plain Kubernetes API server answers 404 there.
 */
import type { KubeOAuthEndpoints } from "@faws/contracts";

import { httpRequest, jsonOf } from "./http.ts";

interface RawMetadata {
  readonly issuer?: unknown;
  readonly authorization_endpoint?: unknown;
  readonly token_endpoint?: unknown;
  readonly code_challenge_methods_supported?: unknown;
}

export async function discoverOAuth(
  server: string,
  options: { ca?: readonly string[]; signal?: AbortSignal } = {},
): Promise<KubeOAuthEndpoints | null> {
  const response = await httpRequest(`${server}/.well-known/oauth-authorization-server`, options);
  if (response.status !== 200) return null;
  const raw = jsonOf<RawMetadata>(response);
  if (
    typeof raw?.issuer !== "string" ||
    typeof raw.authorization_endpoint !== "string" ||
    typeof raw.token_endpoint !== "string"
  ) {
    return null;
  }
  const methods = Array.isArray(raw.code_challenge_methods_supported)
    ? raw.code_challenge_methods_supported
    : [];
  return {
    issuer: raw.issuer,
    authorizationEndpoint: raw.authorization_endpoint,
    tokenEndpoint: raw.token_endpoint,
    tokenRequestUrl: `${raw.issuer.replace(/\/$/, "")}/oauth/token/request`,
    pkce: methods.includes("S256"),
  };
}
