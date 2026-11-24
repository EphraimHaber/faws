/**
 * Signing in through the browser: authorization code with PKCE, delivered to
 * a one shot listener on the loopback interface.
 *
 * The listener binds 127.0.0.1 on a port the OS picks, answers one path, and
 * closes after the first callback that carries the right `state`, or when the
 * time runs out. The code is useless without the verifier, which never leaves
 * this process.
 */
import { randomBytes, randomUUID } from "node:crypto";
import * as http from "node:http";
import type { AddressInfo } from "node:net";

import type { KubeOAuthEndpoints } from "@faws/contracts";

import { KubeLoginError } from "../errors.ts";
import { BROWSER_CLIENT, createPkce, exchangeCode, type IssuedToken } from "./oauth.ts";

/** Long enough to find a password manager and approve a second factor. */
export const BROWSER_LOGIN_TIMEOUT_MS = 5 * 60_000;

export interface BrowserLogin {
  readonly id: string;
  readonly authorizeUrl: string;
  /** Resolves with the token once the browser comes back; rejects on timeout, refusal or cancel. */
  readonly token: Promise<IssuedToken>;
  cancel(): void;
}

const PAGE = (title: string, line: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font:14px system-ui;margin:3rem;color:#222"><h1 style="font-size:18px">${title}</h1><p>${line}</p></body>`;

export async function startBrowserLogin(
  endpoints: KubeOAuthEndpoints,
  options: { ca?: readonly string[]; timeoutMs?: number } = {},
): Promise<BrowserLogin> {
  const pkce = createPkce();
  const state = randomBytes(24).toString("base64url");

  let settle: { resolve: (code: string) => void; reject: (err: Error) => void } | null = null;
  const code = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject };
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method !== "GET" || url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    // A request without our state is someone else's; it neither ends nor spends this login.
    if (url.searchParams.get("state") !== state) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        PAGE("Sign in not recognised", "This link does not belong to a sign in faws started."),
      );
      return;
    }
    const error = url.searchParams.get("error");
    const received = url.searchParams.get("code");
    res.writeHead(error || !received ? 400 : 200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    if (error || !received) {
      res.end(PAGE("Sign in failed", "Return to faws to see why."));
      settle?.reject(
        new KubeLoginError(
          endpoints.issuer,
          `The OAuth server refused the sign in: ${url.searchParams.get("error_description") ?? error ?? "no code returned"}.`,
        ),
      );
    } else {
      res.end(PAGE("Signed in", "You can close this tab and return to faws."));
      settle?.resolve(received);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const authorize = new URL(endpoints.authorizationEndpoint);
  authorize.searchParams.set("client_id", BROWSER_CLIENT);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", pkce.challenge);
  authorize.searchParams.set("code_challenge_method", "S256");

  const timer = setTimeout(
    () =>
      settle?.reject(
        new KubeLoginError(endpoints.issuer, "The browser sign in timed out. Start it again."),
      ),
    options.timeoutMs ?? BROWSER_LOGIN_TIMEOUT_MS,
  );

  const finish = () => {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections();
  };

  const token = code.then(
    (received) => {
      finish();
      return exchangeCode(endpoints, {
        clientId: BROWSER_CLIENT,
        code: received,
        redirectUri,
        verifier: pkce.verifier,
        transport: options.ca ? { ca: options.ca } : {},
      });
    },
    (err: unknown) => {
      finish();
      throw err;
    },
  );
  // Nobody may be awaiting yet; a rejection is still delivered to whoever awaits later.
  token.catch(() => {});

  return {
    id: randomUUID(),
    authorizeUrl: authorize.toString(),
    token,
    cancel: () =>
      settle?.reject(new KubeLoginError(endpoints.issuer, "The browser sign in was cancelled.")),
  };
}
