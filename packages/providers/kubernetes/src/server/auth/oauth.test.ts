import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { KubeLoginError } from "../errors.ts";
import { type FakeOpenShift, startFakeOpenShift } from "../testing/fakeOpenShift.ts";
import { startBrowserLogin } from "./browserLogin.ts";
import { discoverOAuth } from "./discovery.ts";
import { httpRequest } from "./http.ts";
import {
  createPkce,
  identify,
  passwordLogin,
  revokeToken,
  tokenExpiry,
  tokenObjectName,
} from "./oauth.ts";

let fake: FakeOpenShift | null = null;
afterEach(async () => {
  await fake?.close();
  fake = null;
});

async function endpoints(options: Parameters<typeof startFakeOpenShift>[0] = {}) {
  fake = await startFakeOpenShift(options);
  const found = await discoverOAuth(fake.url);
  if (!found) throw new Error("discovery failed");
  return found;
}

describe("discovery", () => {
  it("finds the OAuth server and whether it takes PKCE", async () => {
    const found = await endpoints();
    expect(found.authorizationEndpoint).toBe(`${fake!.url}/oauth/authorize`);
    expect(found.tokenRequestUrl).toBe(`${fake!.url}/oauth/token/request`);
    expect(found.pkce).toBe(true);
  });

  it("answers null for a plain Kubernetes API server", async () => {
    fake = await startFakeOpenShift({ plainKubernetes: true });
    expect(await discoverOAuth(fake.url)).toBeNull();
  });
});

describe("PKCE", () => {
  it("makes an S256 challenge of its verifier", () => {
    const pkce = createPkce();
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkce.challenge).toBe(createHash("sha256").update(pkce.verifier).digest("base64url"));
  });
});

describe("username and password", () => {
  it("swaps a challenge for a token, with PKCE", async () => {
    const found = await endpoints();
    const issued = await passwordLogin(found, "alice", "wonderland");
    expect(issued.accessToken).toMatch(/^sha256~/);
    expect(issued.expiresAt).not.toBeNull();
    expect(fake!.tokens.get(issued.accessToken)?.user).toBe("alice");
  });

  it("works without PKCE where the server does not offer it", async () => {
    const found = await endpoints({ pkce: false });
    expect(found.pkce).toBe(false);
    const issued = await passwordLogin(found, "alice", "wonderland");
    expect(fake!.tokens.has(issued.accessToken)).toBe(true);
  });

  it("refuses a wrong password with a sentence, not a status code", async () => {
    const found = await endpoints();
    await expect(passwordLogin(found, "alice", "nope")).rejects.toThrow(
      /username and password were not accepted/,
    );
    await expect(passwordLogin(found, "alice", "nope")).rejects.toBeInstanceOf(KubeLoginError);
  });
});

describe("a token", () => {
  it("is checked against users/~ on OpenShift", async () => {
    const found = await endpoints();
    const { accessToken } = await passwordLogin(found, "alice", "wonderland");
    expect(await identify(fake!.url, accessToken, true)).toEqual({ username: "alice" });
    await expect(identify(fake!.url, "sha256~bogus", true)).rejects.toThrow(/did not accept/);
  });

  it("is checked with a SelfSubjectReview on plain Kubernetes", async () => {
    fake = await startFakeOpenShift({ plainKubernetes: true });
    const token = fake.issueToken("bob");
    expect(await identify(fake.url, token, false)).toEqual({ username: "bob" });
  });

  it("is named by its hash, as OpenShift stores it", () => {
    expect(tokenObjectName("sha256~abc")).toBe(
      `sha256~${createHash("sha256").update("abc").digest("base64url")}`,
    );
    expect(tokenObjectName("eyJhbGciOi")).toBeNull();
  });

  it("reports when it expires, and expired once revoked", async () => {
    const found = await endpoints({ tokenLifetime: 3600 });
    const { accessToken } = await passwordLogin(found, "alice", "wonderland");
    const before = await tokenExpiry(fake!.url, accessToken);
    expect(before.state).toBe("valid");
    const lifetime = Date.parse(before.expiresAt!) - Date.now();
    expect(lifetime).toBeGreaterThan(3500_000);
    expect(lifetime).toBeLessThanOrEqual(3600_000);

    expect(await revokeToken(fake!.url, accessToken)).toBe(true);
    expect(fake!.revoked).toEqual([accessToken]);
    expect((await tokenExpiry(fake!.url, accessToken)).state).toBe("expired");
  });
});

describe("browser sign in", () => {
  it("receives the code on the loopback listener and swaps it with the verifier", async () => {
    const found = await endpoints();
    const login = await startBrowserLogin(found);
    const authorize = new URL(login.authorizeUrl);
    expect(authorize.searchParams.get("client_id")).toBe("openshift-cli-client");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("redirect_uri")).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/callback$/,
    );

    // Play the browser: the OAuth server redirects to the loopback listener.
    const redirect = await httpRequest(login.authorizeUrl);
    expect(redirect.status).toBe(302);
    const landed = await httpRequest(String(redirect.headers.location));
    expect(landed.status).toBe(200);

    const issued = await login.token;
    expect(fake!.tokens.get(issued.accessToken)?.user).toBe("alice");
  });

  it("ignores a callback with the wrong state, and is spent after the right one", async () => {
    const found = await endpoints();
    const login = await startBrowserLogin(found);
    const redirect = await httpRequest(login.authorizeUrl);
    const target = new URL(String(redirect.headers.location));

    const forged = new URL(target);
    forged.searchParams.set("state", "forged");
    expect((await httpRequest(forged.toString())).status).toBe(400);

    await httpRequest(target.toString());
    await login.token;
    await expect(httpRequest(target.toString())).rejects.toThrow(/could not be reached/);
  });

  it("times out and can be cancelled", async () => {
    const found = await endpoints();
    const slow = await startBrowserLogin(found, { timeoutMs: 50 });
    await expect(slow.token).rejects.toThrow(/timed out/);

    const cancelled = await startBrowserLogin(found);
    cancelled.cancel();
    await expect(cancelled.token).rejects.toThrow(/cancelled/);
  });
});
