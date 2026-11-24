/**
 * A small stand in for an OpenShift API server and its OAuth server on one
 * loopback port, enough to drive every login flow end to end: discovery, the
 * challenging client, the browser client with PKCE, token checks, expiry
 * lookups, revocation, projects, and a pod list.
 */
import { createHash, randomBytes } from "node:crypto";
import * as http from "node:http";
import * as https from "node:https";
import type { AddressInfo } from "node:net";

export interface FakeOpenShiftOptions {
  readonly users?: Readonly<Record<string, string>>;
  readonly pkce?: boolean;
  /** Seconds a token lasts. */
  readonly tokenLifetime?: number;
  readonly projects?: readonly string[];
  /** Answer 404 at discovery, as a plain Kubernetes API server does. */
  readonly plainKubernetes?: boolean;
  readonly pods?: number;
  /** Serve https with this key and certificate instead of plain http. */
  readonly tls?: { readonly key: string; readonly cert: string };
}

export interface FakeOpenShift {
  readonly url: string;
  /** Tokens the server currently honours, by token. */
  readonly tokens: Map<string, { user: string; created: string }>;
  readonly revoked: string[];
  /** Every request's method and path, for asserting what was asked. */
  readonly requests: string[];
  issueToken(user: string): string;
  close(): Promise<void>;
}

function objectName(token: string): string {
  return `sha256~${createHash("sha256").update(token.slice("sha256~".length)).digest("base64url")}`;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export async function startFakeOpenShift(
  options: FakeOpenShiftOptions = {},
): Promise<FakeOpenShift> {
  const users = options.users ?? { alice: "wonderland" };
  const tokens = new Map<string, { user: string; created: string }>();
  const codes = new Map<
    string,
    { user: string; client: string; challenge: string | null; redirect: string }
  >();
  const revoked: string[] = [];
  const requests: string[] = [];
  let base = "";

  const issueToken = (user: string) => {
    const token = `sha256~${randomBytes(24).toString("base64url")}`;
    tokens.set(token, { user, created: new Date().toISOString() });
    return token;
  };
  const bearerUser = (req: http.IncomingMessage) => {
    const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
    return match?.[1]
      ? tokens.get(match[1])
        ? { token: match[1], ...tokens.get(match[1])! }
        : null
      : null;
  };
  const unauthorized = (res: http.ServerResponse) =>
    json(res, 401, { kind: "Status", status: "Failure", reason: "Unauthorized", code: 401 });

  const handle = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? "/", base);
    requests.push(`${req.method} ${url.pathname}`);
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      route(req, res, url, body);
    });
  };
  const server = options.tls ? https.createServer(options.tls, handle) : http.createServer(handle);

  function route(req: http.IncomingMessage, res: http.ServerResponse, url: URL, body: string) {
    const path = url.pathname;

    if (path === "/version") return json(res, 200, { gitVersion: "v1.31.4" });

    if (path === "/.well-known/oauth-authorization-server") {
      if (options.plainKubernetes) return json(res, 404, {});
      return json(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/oauth/authorize`,
        token_endpoint: `${base}/oauth/token`,
        code_challenge_methods_supported: options.pkce === false ? [] : ["plain", "S256"],
      });
    }

    if (path === "/oauth/authorize") {
      const client = url.searchParams.get("client_id") ?? "";
      const challenge = url.searchParams.get("code_challenge");
      if (client === "openshift-challenging-client") {
        if (req.headers["x-csrf-token"] !== "1") return json(res, 400, { error: "csrf" });
        const match = /^Basic (.+)$/.exec(req.headers.authorization ?? "");
        const [user, password] = match?.[1]
          ? Buffer.from(match[1], "base64").toString().split(":")
          : [];
        if (!user || users[user] === undefined || users[user] !== password) {
          res.writeHead(401, { "WWW-Authenticate": 'Basic realm="openshift"' });
          return res.end();
        }
        const code = randomBytes(12).toString("hex");
        const redirect = `${base}/oauth/token/implicit`;
        codes.set(code, { user, client, challenge, redirect });
        res.writeHead(302, { Location: `${redirect}?code=${code}&state=` });
        return res.end();
      }
      if (client === "openshift-cli-client") {
        // A real server shows a login page here; the fake signs in as the first user.
        const redirect = url.searchParams.get("redirect_uri") ?? "";
        if (!/^http:\/\/127\.0\.0\.1:\d+\/callback$/.test(redirect)) {
          return json(res, 400, { error: "invalid_redirect" });
        }
        const user = Object.keys(users)[0] ?? "alice";
        const code = randomBytes(12).toString("hex");
        codes.set(code, { user, client, challenge, redirect });
        const target = new URL(redirect);
        target.searchParams.set("code", code);
        target.searchParams.set("state", url.searchParams.get("state") ?? "");
        res.writeHead(302, { Location: target.toString() });
        return res.end();
      }
      return json(res, 400, { error: "unauthorized_client" });
    }

    if (path === "/oauth/token" && req.method === "POST") {
      const form = new URLSearchParams(body);
      const entry = codes.get(form.get("code") ?? "");
      codes.delete(form.get("code") ?? "");
      const clientAuth = /^Basic (.+)$/.exec(req.headers.authorization ?? "");
      const clientId = clientAuth?.[1]
        ? Buffer.from(clientAuth[1], "base64").toString().split(":")[0]
        : form.get("client_id");
      if (!entry || entry.client !== clientId || entry.redirect !== form.get("redirect_uri")) {
        return json(res, 400, { error: "invalid_grant" });
      }
      if (entry.challenge) {
        const verifier = form.get("code_verifier") ?? "";
        const expected = createHash("sha256").update(verifier).digest("base64url");
        if (expected !== entry.challenge)
          return json(res, 400, { error: "invalid_grant", error_description: "PKCE" });
      }
      return json(res, 200, {
        access_token: issueToken(entry.user),
        token_type: "Bearer",
        expires_in: options.tokenLifetime ?? 86400,
      });
    }

    if (path === "/oauth/token/request") return json(res, 200, { page: "token request" });

    if (path === "/apis/user.openshift.io/v1/users/~") {
      const who = bearerUser(req);
      return who ? json(res, 200, { metadata: { name: who.user } }) : unauthorized(res);
    }

    if (path === "/apis/project.openshift.io/v1/projects") {
      if (!bearerUser(req)) return unauthorized(res);
      return json(res, 200, {
        items: (options.projects ?? ["payments", "default"]).map((name) => ({
          metadata: { name },
        })),
      });
    }

    const tokenObject =
      /^\/apis\/oauth\.openshift\.io\/v1\/(useroauthaccesstokens|oauthaccesstokens)\/(.+)$/.exec(
        path,
      );
    if (tokenObject) {
      const who = bearerUser(req);
      if (!who) return unauthorized(res);
      const name = decodeURIComponent(tokenObject[2] ?? "");
      if (name !== objectName(who.token)) return json(res, 404, {});
      if (req.method === "DELETE") {
        tokens.delete(who.token);
        revoked.push(who.token);
        return json(res, 200, { kind: "Status", status: "Success" });
      }
      return json(res, 200, {
        metadata: { name, creationTimestamp: who.created },
        expiresIn: options.tokenLifetime ?? 86400,
        userName: who.user,
      });
    }

    if (path === "/apis/authentication.k8s.io/v1/selfsubjectreviews" && req.method === "POST") {
      const who = bearerUser(req);
      return who
        ? json(res, 201, { status: { userInfo: { username: who.user } } })
        : unauthorized(res);
    }

    if (path === "/api/v1/namespaces") {
      if (!bearerUser(req)) return unauthorized(res);
      return json(res, 200, {
        kind: "NamespaceList",
        items: (options.projects ?? ["payments", "default"]).map((name) => ({
          metadata: { name, creationTimestamp: "2026-01-01T00:00:00Z" },
          status: { phase: "Active" },
        })),
      });
    }

    const pods = /^\/api\/v1\/namespaces\/([^/]+)\/pods$/.exec(path);
    if (pods) {
      if (!bearerUser(req)) return unauthorized(res);
      return json(res, 200, {
        kind: "PodList",
        items: Array.from({ length: options.pods ?? 3 }, (_, index) => ({
          metadata: {
            name: `api-${index}`,
            namespace: pods[1],
            creationTimestamp: "2026-01-01T00:00:00Z",
          },
          spec: { nodeName: "node-1", containers: [{ name: "app" }] },
          status: {
            phase: "Running",
            podIP: `10.0.0.${index + 1}`,
            containerStatuses: [
              { name: "app", image: "app:1", ready: true, restartCount: 0, state: { running: {} } },
            ],
          },
        })),
      });
    }

    return json(res, 404, { kind: "Status", code: 404 });
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  base = `${options.tls ? "https" : "http"}://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    url: base,
    tokens,
    revoked,
    requests,
    issueToken,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
