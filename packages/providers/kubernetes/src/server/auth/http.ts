/**
 * One HTTP exchange with an API or OAuth server, without following redirects.
 *
 * The OAuth flows read the `Location` of a 302 rather than following it, and
 * every caller decides what a status means, so this never throws on one. It
 * trusts what Node trusts by default (the app's trust store), plus any CA a
 * kubeconfig names for that cluster.
 */
import * as http from "node:http";
import * as https from "node:https";
import * as tls from "node:tls";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface HttpRequest {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  /** PEM certificates trusted for this request on top of the default set. */
  readonly ca?: readonly string[];
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}

/** The request never got an answer: refused, unresolvable, timed out or refused at TLS. */
export class HttpUnreachableError extends Error {
  readonly code: string | null;
  readonly url: string;

  constructor(url: string, cause: unknown) {
    const code = (cause as { code?: unknown }).code;
    super(
      `${new URL(url).host} could not be reached: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "HttpUnreachableError";
    this.url = url;
    this.code = typeof code === "string" ? code : null;
  }
}

export function httpRequest(url: string, options: HttpRequest = {}): Promise<HttpResponse> {
  const target = new URL(url);
  const client = target.protocol === "http:" ? http : https;
  const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
  if (options.body !== undefined)
    headers["Content-Length"] = String(Buffer.byteLength(options.body));

  return new Promise((resolve, reject) => {
    const req = client.request(
      target,
      {
        method: options.method ?? "GET",
        headers,
        ...(options.ca && options.ca.length > 0
          ? { ca: [...tls.getCACertificates("default"), ...options.ca] }
          : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            req.destroy(new Error("The response was larger than expected."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        res.on("error", (err) => reject(new HttpUnreachableError(url, err)));
      },
    );
    req.on("timeout", () => req.destroy(new Error("No answer within the time limit.")));
    req.on("error", (err) => reject(new HttpUnreachableError(url, err)));
    req.end(options.body);
  });
}

/** The body as JSON, or null when it is not JSON. */
export function jsonOf<T>(response: HttpResponse): T | null {
  try {
    return JSON.parse(response.body) as T;
  } catch {
    return null;
  }
}

export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export function basic(user: string, password: string): Record<string, string> {
  return { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}` };
}
