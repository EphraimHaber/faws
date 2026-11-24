/**
 * Getting, checking and giving back an OpenShift token, the way `oc` does.
 *
 * Usernames, passwords and tokens only ever travel in request headers and
 * bodies, never in a URL or on a command line.
 */
import { createHash, randomBytes } from "node:crypto";

import type { KubeOAuthEndpoints } from "@faws/contracts";

import { KubeLoginError } from "../errors.ts";
import { basic, bearer, httpRequest, type HttpRequest, jsonOf } from "./http.ts";

export const CHALLENGING_CLIENT = "openshift-challenging-client";
export const BROWSER_CLIENT = "openshift-cli-client";

type Transport = Pick<HttpRequest, "ca" | "signal">;

export interface Pkce {
  readonly verifier: string;
  readonly challenge: string;
}

export function createPkce(): Pkce {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export interface IssuedToken {
  readonly accessToken: string;
  readonly expiresAt: string | null;
}

/**
 * Username and password, through the challenging client: the authorize
 * endpoint answers a Basic challenge with a redirect carrying a code, which
 * the token endpoint swaps for a token. `X-CSRF-Token` is what the OAuth
 * server asks of a non browser client before it will challenge at all.
 */
export async function passwordLogin(
  endpoints: KubeOAuthEndpoints,
  username: string,
  password: string,
  transport: Transport = {},
): Promise<IssuedToken> {
  const pkce = endpoints.pkce ? createPkce() : null;
  const authorize = new URL(endpoints.authorizationEndpoint);
  authorize.searchParams.set("client_id", CHALLENGING_CLIENT);
  authorize.searchParams.set("response_type", "code");
  if (pkce) {
    authorize.searchParams.set("code_challenge", pkce.challenge);
    authorize.searchParams.set("code_challenge_method", "S256");
  }

  const response = await httpRequest(authorize.toString(), {
    ...transport,
    headers: { ...basic(username, password), "X-CSRF-Token": "1" },
  });

  if (response.status === 401) {
    throw new KubeLoginError(endpoints.issuer, "That username and password were not accepted.");
  }
  const location = response.headers.location;
  if (response.status !== 302 || typeof location !== "string") {
    throw new KubeLoginError(
      endpoints.issuer,
      `The OAuth server answered ${response.status} instead of issuing a code. It may not accept passwords; try signing in through the browser or pasting a token.`,
    );
  }
  const redirect = new URL(location, endpoints.authorizationEndpoint);
  const error = redirect.searchParams.get("error");
  if (error) {
    const description = redirect.searchParams.get("error_description");
    throw new KubeLoginError(
      endpoints.issuer,
      `The OAuth server refused: ${description ?? error}.`,
    );
  }
  const code = redirect.searchParams.get("code");
  if (!code) {
    throw new KubeLoginError(
      endpoints.issuer,
      "The OAuth server redirected without a code. It may want a browser sign in for this account.",
    );
  }

  return exchangeCode(endpoints, {
    clientId: CHALLENGING_CLIENT,
    code,
    redirectUri: `${endpoints.issuer.replace(/\/$/, "")}/oauth/token/implicit`,
    verifier: pkce?.verifier ?? null,
    transport,
  });
}

/** Swaps an authorization code for a token at the token endpoint. */
export async function exchangeCode(
  endpoints: KubeOAuthEndpoints,
  options: {
    clientId: string;
    code: string;
    redirectUri: string;
    verifier: string | null;
    transport?: Transport;
  },
): Promise<IssuedToken> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: options.code,
    redirect_uri: options.redirectUri,
    client_id: options.clientId,
  });
  if (options.verifier) form.set("code_verifier", options.verifier);

  const response = await httpRequest(endpoints.tokenEndpoint, {
    ...options.transport,
    method: "POST",
    headers: {
      // OpenShift's CLI clients are public: their secret is empty.
      ...basic(options.clientId, ""),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const body = jsonOf<{
    access_token?: unknown;
    expires_in?: unknown;
    error?: unknown;
    error_description?: unknown;
  }>(response);
  if (response.status !== 200 || typeof body?.access_token !== "string") {
    const why =
      typeof body?.error_description === "string"
        ? body.error_description
        : typeof body?.error === "string"
          ? body.error
          : `status ${response.status}`;
    throw new KubeLoginError(endpoints.issuer, `The token endpoint refused the code: ${why}.`);
  }
  return {
    accessToken: body.access_token,
    expiresAt:
      typeof body.expires_in === "number"
        ? new Date(Date.now() + body.expires_in * 1000).toISOString()
        : null,
  };
}

/**
 * The name of the OAuthAccessToken object behind a `sha256~` token: the
 * object is stored under a hash, so the token itself is never a name.
 */
export function tokenObjectName(token: string): string | null {
  if (!token.startsWith("sha256~")) return null;
  const secret = token.slice("sha256~".length);
  return `sha256~${createHash("sha256").update(secret).digest("base64url")}`;
}

export interface TokenIdentity {
  /** Null when the server would not say who the token belongs to. */
  readonly username: string | null;
}

/**
 * Checks a token works, and whose it is. OpenShift names the user at
 * `users/~`; plain Kubernetes at a SelfSubjectReview, or, on servers older
 * than that API, a list call that only needs authentication to not be 401.
 */
export async function identify(
  server: string,
  token: string,
  openShift: boolean,
  transport: Transport = {},
): Promise<TokenIdentity> {
  const auth = { ...transport, headers: bearer(token) };
  if (openShift) {
    const response = await httpRequest(`${server}/apis/user.openshift.io/v1/users/~`, auth);
    refuseUnauthorized(server, response.status);
    const body = jsonOf<{ metadata?: { name?: unknown } }>(response);
    if (response.status === 200 && typeof body?.metadata?.name === "string") {
      return { username: body.metadata.name };
    }
    throw new KubeLoginError(server, `The cluster answered ${response.status} asking who you are.`);
  }

  const review = await httpRequest(`${server}/apis/authentication.k8s.io/v1/selfsubjectreviews`, {
    ...auth,
    method: "POST",
    headers: { ...bearer(token), "Content-Type": "application/json" },
    body: JSON.stringify({ apiVersion: "authentication.k8s.io/v1", kind: "SelfSubjectReview" }),
  });
  refuseUnauthorized(server, review.status);
  const body = jsonOf<{ status?: { userInfo?: { username?: unknown } } }>(review);
  if (review.status === 201 || review.status === 200) {
    const username = body?.status?.userInfo?.username;
    return { username: typeof username === "string" ? username : null };
  }

  const list = await httpRequest(`${server}/api/v1/namespaces?limit=1`, auth);
  refuseUnauthorized(server, list.status);
  return { username: null };
}

function refuseUnauthorized(server: string, status: number) {
  if (status === 401) {
    throw new KubeLoginError(server, "The cluster did not accept that token. It may have expired.");
  }
}

/** When a token expires, from its own OAuthAccessToken; null when the server will not say. */
export async function tokenExpiry(
  server: string,
  token: string,
  transport: Transport = {},
): Promise<{ state: "valid" | "expired" | "unknown"; expiresAt: string | null }> {
  const name = tokenObjectName(token);
  if (!name) return { state: "unknown", expiresAt: null };
  const response = await httpRequest(
    `${server}/apis/oauth.openshift.io/v1/useroauthaccesstokens/${encodeURIComponent(name)}`,
    { ...transport, headers: bearer(token), timeoutMs: 5000 },
  );
  if (response.status === 401) return { state: "expired", expiresAt: null };
  if (response.status !== 200) return { state: "unknown", expiresAt: null };
  const body = jsonOf<{ expiresIn?: unknown; metadata?: { creationTimestamp?: unknown } }>(
    response,
  );
  const created = body?.metadata?.creationTimestamp;
  const expiresIn = body?.expiresIn;
  if (typeof created !== "string" || typeof expiresIn !== "number" || expiresIn <= 0) {
    return { state: "valid", expiresAt: null };
  }
  return {
    state: "valid",
    expiresAt: new Date(Date.parse(created) + expiresIn * 1000).toISOString(),
  };
}

/**
 * Asks the server to forget a token, as `oc logout` does. True when it is
 * gone there; false when the server would not say, which still leaves the
 * local copy to clear.
 */
export async function revokeToken(
  server: string,
  token: string,
  transport: Transport = {},
): Promise<boolean> {
  const name = tokenObjectName(token);
  if (!name) return false;
  for (const resource of ["oauthaccesstokens", "useroauthaccesstokens"]) {
    try {
      const response = await httpRequest(
        `${server}/apis/oauth.openshift.io/v1/${resource}/${encodeURIComponent(name)}`,
        { ...transport, method: "DELETE", headers: bearer(token), timeoutMs: 5000 },
      );
      if (response.status === 200 || response.status === 202) return true;
      // Already expired or gone: nothing left on the server to revoke.
      if (response.status === 401 || response.status === 404) return true;
    } catch {
      return false;
    }
  }
  return false;
}
