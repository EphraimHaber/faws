/**
 * Adding a cluster, logging in again and logging out, end to end: discovery,
 * the OAuth flow, checking the token, and writing the result where `oc`
 * would. Tokens never leave this process except into the kubeconfig and the
 * cluster's own endpoints.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  EndpointTrustError,
  type KubeBrowserLoginStart,
  type KubeClusterProbe,
  type KubeContextInfo,
  type KubeLoginResult,
  type KubeLoginStatus,
  type KubeLogoutResult,
  type KubeOAuthEndpoints,
  type KubeTlsVerdict,
} from "@faws/contracts";
import { trustReason } from "@faws/shared";

import { startBrowserLogin as openLoopback, type BrowserLogin } from "./auth/browserLogin.ts";
import { discoverOAuth } from "./auth/discovery.ts";
import { bearer, httpRequest, HttpUnreachableError, jsonOf } from "./auth/http.ts";
import {
  identify,
  type IssuedToken,
  passwordLogin,
  revokeToken,
  tokenExpiry,
} from "./auth/oauth.ts";
import { anchorsFor, appTrustedCAs, inspectTls } from "./auth/tls.ts";
import { KubeLoginError, userLabel } from "./errors.ts";
import { existingKubeconfigPaths, forgetKubeContexts, listKubeContexts } from "./kubeconfig.ts";
import {
  mergeLogin,
  readKubeconfigFile,
  type RawKubeconfig,
  setClusterAuthority,
  setUserToken,
  targetKubeconfig,
  updateKubeconfig,
  userToken,
} from "./kubeconfigWriter.ts";

interface Signal {
  readonly signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Probing

export async function probeCluster(
  server: string,
  options: Signal = {},
): Promise<KubeClusterProbe> {
  const url = new URL(server);
  const base: KubeClusterProbe = {
    server,
    reachable: false,
    problem: null,
    api: null,
    openShift: false,
    oauth: null,
    oauthTls: null,
    version: null,
  };

  let api: KubeTlsVerdict | null = null;
  if (url.protocol === "https:") {
    try {
      api = (await inspectTls(url.hostname, portOf(url))).verdict;
    } catch (err) {
      return { ...base, problem: `${url.host} could not be reached: ${messageOf(err)}` };
    }
    // Nothing more can be asked until the certificate is trusted.
    if (!api.authorized) return { ...base, reachable: true, api };
  }

  try {
    const version = await httpRequest(`${server}/version`, options);
    const oauth = await discoverOAuth(server, options);
    let oauthTls: KubeTlsVerdict | null = null;
    if (oauth) {
      const oauthUrl = new URL(oauth.authorizationEndpoint);
      if (oauthUrl.protocol === "https:") {
        oauthTls = await inspectTls(oauthUrl.hostname, portOf(oauthUrl))
          .then((presented) => presented.verdict)
          .catch(() => null);
      }
    }
    const gitVersion = jsonOf<{ gitVersion?: unknown }>(version)?.gitVersion;
    return {
      ...base,
      reachable: true,
      api,
      openShift: oauth !== null,
      oauth,
      oauthTls,
      version: typeof gitVersion === "string" ? gitVersion : null,
    };
  } catch (err) {
    return { ...base, api, problem: messageOf(err) };
  }
}

// ---------------------------------------------------------------------------
// Logging in

interface Credentials {
  readonly method: "password" | "token";
  readonly username: string;
  readonly password: string;
  readonly token: string;
}

/** A new login to `server`, written as the context `oc login` would write. */
export async function login(
  input: Credentials & { server: string; namespace: string },
  options: Signal = {},
): Promise<KubeLoginResult> {
  const oauth = await discover(input.server, options);
  const issued = await obtainToken(input.server, oauth, input);
  return finishNewLogin(input.server, oauth, issued, input.username, input.namespace);
}

/** Logs in again to an existing context, keeping its server, user and namespace. */
export async function relogin(
  input: Credentials & { context: string },
  options: Signal = {},
): Promise<KubeLoginResult> {
  const found = await findContext(input.context);
  const oauth = await discover(found.server, { ...options, ca: found.ca });
  const username = input.username || userLabel(found.userName);
  const issued = await obtainToken(found.server, oauth, { ...input, username });
  return finishRelogin(found, oauth, issued, username);
}

async function obtainToken(
  server: string,
  oauth: KubeOAuthEndpoints | null,
  input: Credentials,
): Promise<IssuedToken> {
  if (input.method === "token") return { accessToken: input.token, expiresAt: null };
  if (!oauth) {
    throw new KubeLoginError(
      server,
      "This cluster has no OpenShift OAuth server, so it cannot take a password. Paste a token instead.",
    );
  }
  return trusted(server, () => passwordLogin(oauth, input.username, input.password));
}

async function finishNewLogin(
  server: string,
  oauth: KubeOAuthEndpoints | null,
  issued: IssuedToken,
  typedUsername: string,
  typedNamespace: string,
): Promise<KubeLoginResult> {
  const identity = await trusted(server, () =>
    identify(server, issued.accessToken, oauth !== null),
  );
  const username = identity.username ?? (typedUsername || "user");
  const namespace =
    typedNamespace || (oauth ? await firstProject(server, issued.accessToken) : "default");
  const authority = await authorityToWrite(server);

  const file = targetKubeconfig();
  const written = await updateKubeconfig(file, (doc) =>
    mergeLogin(doc, {
      server,
      username,
      token: issued.accessToken,
      namespace,
      certificateAuthority: authority,
    }),
  );
  forgetKubeContexts();

  return {
    context: written.context,
    server,
    user: written.user,
    namespace,
    kubeconfig: file,
    wroteCertificateAuthority: authority !== null,
    expiresAt: issued.expiresAt ?? (await expiryOf(server, issued.accessToken)),
  };
}

async function finishRelogin(
  found: FoundContext,
  oauth: KubeOAuthEndpoints | null,
  issued: IssuedToken,
  username: string,
): Promise<KubeLoginResult> {
  const identity = await trusted(found.server, () =>
    identify(found.server, issued.accessToken, oauth !== null, { ca: found.ca }),
  );
  // Logged in as someone else: that is a new login, not a renewal of this one.
  if (identity.username && identity.username !== userLabel(found.userName)) {
    return finishNewLogin(found.server, oauth, issued, username, found.namespace ?? "");
  }

  const authority = found.ca.length > 0 ? null : await authorityToWrite(found.server);
  await updateKubeconfig(found.userFile, (doc) => {
    if (!setUserToken(doc, found.userName, issued.accessToken)) {
      throw new KubeLoginError(
        found.server,
        `${found.userFile} no longer has the user ${found.userName}.`,
      );
    }
  });
  if (authority) {
    await updateKubeconfig(found.clusterFile, (doc) => {
      setClusterAuthority(doc, found.clusterName, authority);
    });
  }
  forgetKubeContexts();

  return {
    context: found.name,
    server: found.server,
    user: found.userName,
    namespace: found.namespace ?? "default",
    kubeconfig: found.userFile,
    wroteCertificateAuthority: authority !== null,
    expiresAt: issued.expiresAt ?? (await expiryOf(found.server, issued.accessToken, found.ca)),
  };
}

// ---------------------------------------------------------------------------
// Browser sign in

interface PendingBrowserLogin {
  readonly login: BrowserLogin;
  readonly server: string;
  readonly oauth: KubeOAuthEndpoints;
  readonly namespace: string;
  readonly context: FoundContext | null;
}

const pending = new Map<string, PendingBrowserLogin>();

export async function startBrowserLogin(
  input: { server: string; namespace: string } | { context: string },
  options: Signal = {},
): Promise<KubeBrowserLoginStart> {
  const context = "context" in input ? await findContext(input.context) : null;
  const server = context?.server ?? ("server" in input ? input.server : "");
  const oauth = await discover(server, { ...options, ca: context?.ca ?? [] });
  if (!oauth) {
    throw new KubeLoginError(
      server,
      "This cluster has no OpenShift OAuth server to sign in through. Paste a token instead.",
    );
  }
  const login = await openLoopback(oauth, context ? { ca: context.ca } : {});
  pending.set(login.id, {
    login,
    server,
    oauth,
    namespace: "namespace" in input ? input.namespace : "",
    context,
  });
  // Forgotten whichever way it ends, so an abandoned login never piles up.
  login.token.finally(() => pending.delete(login.id)).catch(() => {});
  return { loginId: login.id, authorizeUrl: login.authorizeUrl };
}

/** Waits for the browser to come back, then writes the login. Aborting the wait cancels it. */
export async function completeBrowserLogin(
  loginId: string,
  options: Signal = {},
): Promise<KubeLoginResult> {
  const entry = pending.get(loginId);
  if (!entry) {
    throw new KubeLoginError("", "That browser sign in has finished or expired. Start it again.");
  }
  const onAbort = () => entry.login.cancel();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const issued = await entry.login.token;
    return entry.context
      ? await finishRelogin(entry.context, entry.oauth, issued, userLabel(entry.context.userName))
      : await finishNewLogin(entry.server, entry.oauth, issued, "", entry.namespace);
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
}

export function cancelBrowserLogin(loginId: string): void {
  pending.get(loginId)?.login.cancel();
}

// ---------------------------------------------------------------------------
// Logging out, and how each login stands

export async function logout(context: string): Promise<KubeLogoutResult> {
  const found = await findContext(context);
  const revoked = found.token
    ? await revokeToken(found.server, found.token, { ca: found.ca }).catch(() => false)
    : false;
  if (found.token) {
    await updateKubeconfig(found.userFile, (doc) => {
      setUserToken(doc, found.userName, null);
    });
    forgetKubeContexts();
  }
  return { context, revoked };
}

/** Each context's login, asking the cluster only about OpenShift tokens it can look up. */
export async function loginStatuses(options: Signal = {}): Promise<KubeLoginStatus[]> {
  const contexts = await listKubeContexts(options);
  const merged = await readMerged();
  return Promise.all(contexts.map((context) => statusOf(context, merged)));
}

async function statusOf(
  context: KubeContextInfo,
  merged: Awaited<ReturnType<typeof readMerged>>,
): Promise<KubeLoginStatus> {
  if (context.auth === "none") {
    return { context: context.name, state: "logged-out", expiresAt: null };
  }
  const token =
    context.auth === "token" ? (merged.users.get(context.userName)?.token ?? null) : null;
  if (!token || !context.server)
    return { context: context.name, state: "unknown", expiresAt: null };
  const ca = await authorityOf(merged.clusters.get(context.clusterName));
  try {
    const expiry = await tokenExpiry(context.server, token, { ca });
    return { context: context.name, state: expiry.state, expiresAt: expiry.expiresAt };
  } catch {
    return { context: context.name, state: "unknown", expiresAt: null };
  }
}

// ---------------------------------------------------------------------------
// Reading what the kubeconfig already holds

interface FoundContext {
  readonly name: string;
  readonly server: string;
  readonly namespace: string | null;
  readonly clusterName: string;
  readonly clusterFile: string;
  readonly userName: string;
  readonly userFile: string;
  readonly token: string | null;
  /** CAs the kubeconfig names for this cluster, as PEM. */
  readonly ca: string[];
}

interface MergedEntry {
  readonly file: string;
  readonly fields: Record<string, unknown>;
  readonly token?: string | null;
}

/** Every file's entries, the first definition of each name winning, as kubectl merges them. */
async function readMerged() {
  const clusters = new Map<string, MergedEntry>();
  const users = new Map<string, MergedEntry>();
  const contexts = new Map<string, MergedEntry>();
  for (const file of existingKubeconfigPaths()) {
    let doc: RawKubeconfig;
    try {
      doc = await readKubeconfigFile(file);
    } catch {
      continue;
    }
    for (const entry of doc.clusters ?? []) {
      if (entry.name && !clusters.has(entry.name)) {
        clusters.set(entry.name, { file, fields: entry.cluster ?? {} });
      }
    }
    for (const entry of doc.users ?? []) {
      if (entry.name && !users.has(entry.name)) {
        users.set(entry.name, {
          file,
          fields: entry.user ?? {},
          token: userToken(doc, entry.name),
        });
      }
    }
    for (const entry of doc.contexts ?? []) {
      if (entry.name && !contexts.has(entry.name)) {
        contexts.set(entry.name, { file, fields: entry.context ?? {} });
      }
    }
  }
  return { clusters, users, contexts };
}

async function findContext(name: string): Promise<FoundContext> {
  const merged = await readMerged();
  const context = merged.contexts.get(name);
  const clusterName = stringField(context?.fields, "cluster");
  const userName = stringField(context?.fields, "user");
  const cluster = clusterName ? merged.clusters.get(clusterName) : undefined;
  const user = userName ? merged.users.get(userName) : undefined;
  const server = stringField(cluster?.fields, "server");
  if (!context || !clusterName || !userName || !cluster || !user || !server) {
    throw new KubeLoginError(
      server ?? "",
      `The context "${name}" is missing from your kubeconfig, or has no cluster or user.`,
    );
  }
  return {
    name,
    server: server.replace(/\/+$/, ""),
    namespace: stringField(context.fields, "namespace"),
    clusterName,
    clusterFile: cluster.file,
    userName,
    userFile: user.file,
    token: user.token ?? null,
    ca: await authorityOf(cluster),
  };
}

async function authorityOf(cluster: MergedEntry | undefined): Promise<string[]> {
  if (!cluster) return [];
  const data = stringField(cluster.fields, "certificate-authority-data");
  if (data) return [Buffer.from(data, "base64").toString("utf8")];
  const file = stringField(cluster.fields, "certificate-authority");
  if (!file) return [];
  try {
    return [await fs.readFile(path.resolve(path.dirname(cluster.file), file), "utf8")];
  } catch {
    return [];
  }
}

function stringField(fields: Record<string, unknown> | undefined, key: string): string | null {
  const value = fields?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// Helpers

async function discover(
  server: string,
  options: Signal & { ca?: readonly string[] },
): Promise<KubeOAuthEndpoints | null> {
  return trusted(server, () => discoverOAuth(server, options));
}

/**
 * The CAs from this app's trust store that the API server's chain needs, as
 * one PEM bundle, so `oc` and `kubectl` trust the cluster too. Null when the
 * chain stands on roots Go already has.
 */
async function authorityToWrite(server: string): Promise<string | null> {
  const url = new URL(server);
  if (url.protocol !== "https:") return null;
  const presented = await inspectTls(url.hostname, portOf(url)).catch(() => null);
  if (!presented?.verdict.authorized) return null;
  const anchors = anchorsFor(presented.chain, appTrustedCAs());
  return anchors.length > 0 ? anchors.join("\n") : null;
}

/** The namespace `oc login` would pick: `default` when it is visible, else the first project. */
async function firstProject(server: string, token: string): Promise<string> {
  try {
    const response = await httpRequest(`${server}/apis/project.openshift.io/v1/projects`, {
      headers: bearer(token),
    });
    const items = jsonOf<{ items?: Array<{ metadata?: { name?: unknown } }> }>(response)?.items;
    const names = (items ?? [])
      .map((item) => item.metadata?.name)
      .filter((name): name is string => typeof name === "string");
    if (names.length === 0 || names.includes("default")) return "default";
    return names.toSorted()[0] ?? "default";
  } catch {
    return "default";
  }
}

async function expiryOf(server: string, token: string, ca: string[] = []): Promise<string | null> {
  try {
    return (await tokenExpiry(server, token, { ca })).expiresAt;
  } catch {
    return null;
  }
}

/** Restates a refused certificate as the app's own trust error, which the renderer can act on. */
async function trusted<T>(server: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const reason = trustReason(err);
    if (reason) {
      const origin = err instanceof HttpUnreachableError ? new URL(err.url).origin : server;
      throw new EndpointTrustError(origin, reason);
    }
    if (err instanceof HttpUnreachableError) throw new KubeLoginError(server, err.message);
    throw err;
  }
}

function portOf(url: URL): number {
  return Number(url.port || (url.protocol === "http:" ? 80 : 443));
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
