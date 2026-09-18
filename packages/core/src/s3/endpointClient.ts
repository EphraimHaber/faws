/**
 * S3 clients pointed at something other than AWS.
 *
 * Three things separate one of these from the scoped client: the endpoint and
 * addressing style, credentials that do not come from `~/.aws`, and a TLS
 * setup that has to be described rather than assumed, because an on prem
 * endpoint is routinely signed by a CA only its own network trusts.
 */
import * as fs from "node:fs";
import * as https from "node:https";
import * as tls from "node:tls";

import { S3Client } from "@aws-sdk/client-s3";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import type { S3Connection, S3Credential } from "@faws/contracts";
import { AwsRequestError, EndpointTrustError } from "@faws/contracts";
import { NodeHttpHandler } from "@smithy/node-http-handler";

import { credentialFor } from "./connections.ts";

/**
 * The credential to use, when it is not the stored one.
 *
 * Testing an endpoint has to test the keys in the form, including ones that
 * have never been saved and ones that are about to replace what was.
 */
async function credentialOrStored(
  connection: S3Connection,
  supplied: S3Credential | null,
): Promise<S3Credential | null> {
  return supplied ?? (await credentialFor(connection));
}

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

function readPem(path: string, what: string): Buffer {
  try {
    return fs.readFileSync(path);
  } catch (err) {
    throw new AwsRequestError(
      `Could not read the ${what} at ${path}: ${err instanceof Error ? err.message : String(err)}`,
      { code: "BadConfiguration", service: "s3" },
    );
  }
}

/** Colon hex, upper case, which is the form a pin is stored in. */
export function normalizeFingerprint(value: string): string {
  return value.replaceAll(/[^0-9A-Fa-f]/g, "").toUpperCase();
}

/**
 * An agent that will only complete a handshake with one certificate.
 *
 * Node checks a pinned fingerprint nowhere on its own, and the check has to
 * survive verification being off, which is the case it exists for: pinning one
 * self signed certificate is a far narrower grant than accepting every
 * certificate, so the socket is inspected once it is secure rather than left to
 * the chain verifier that may have been told to allow anything.
 */
class PinnedAgent extends https.Agent {
  readonly #pinned: string;

  constructor(options: https.AgentOptions, pinned: string) {
    super(options);
    this.#pinned = normalizeFingerprint(pinned);
  }

  override createConnection(
    options: tls.ConnectionOptions,
    callback?: (err: Error | null, socket: tls.TLSSocket) => void,
    // The base declaration is untyped in node's own definitions; the socket it
    // returns for an https agent is always a TLS one.
  ): tls.TLSSocket {
    const socket = (
      https.Agent.prototype.createConnection as (
        this: https.Agent,
        options: tls.ConnectionOptions,
        callback?: (err: Error | null, socket: tls.TLSSocket) => void,
      ) => tls.TLSSocket
    ).call(this, options, callback);

    socket.on("secureConnect", () => {
      const actual = normalizeFingerprint(socket.getPeerCertificate().fingerprint256 ?? "");
      if (actual === this.#pinned) return;
      const err = new Error(
        "The endpoint presented a certificate that is not the pinned one.",
      ) as Error & { code: string };
      err.code = "ERR_TLS_FINGERPRINT_MISMATCH";
      socket.destroy(err);
    });

    return socket;
  }
}

/** The TLS options a connection describes, ready for an agent or a probe. */
export async function tlsOptionsFor(
  connection: S3Connection,
  supplied: S3Credential | null = null,
): Promise<tls.SecureContextOptions & { rejectUnauthorized: boolean; servername?: string }> {
  const { tls: config } = connection;

  const extraCa = [
    ...config.caPaths.map((path) => readPem(path, "CA certificate")),
    ...(config.caPem ? [Buffer.from(config.caPem)] : []),
  ];

  const passphrase = (await credentialOrStored(connection, supplied))?.clientKeyPassphrase;

  return {
    // A pin decides on its own which certificate is acceptable, and it is set
    // for endpoints whose chain nothing can vouch for. Leaving the chain check
    // on as well would refuse the pinned certificate before it is ever
    // compared, which is the opposite of what pinning one was asked for.
    rejectUnauthorized: config.pinnedSha256 === null && config.verify,
    // Node replaces the default roots when `ca` is given rather than adding to
    // them, so a private CA would otherwise make every public one unknown -
    // which breaks an endpoint whose chain ends at a public root.
    ...(extraCa.length > 0 ? { ca: [...tls.rootCertificates, ...extraCa] } : {}),
    ...(config.clientCertPath
      ? { cert: readPem(config.clientCertPath, "client certificate") }
      : {}),
    ...(config.clientKeyPath ? { key: readPem(config.clientKeyPath, "client key") } : {}),
    ...(passphrase ? { passphrase } : {}),
    ...(config.servername ? { servername: config.servername } : {}),
  };
}

async function agentFor(
  connection: S3Connection,
  supplied: S3Credential | null,
): Promise<https.Agent> {
  const options = await tlsOptionsFor(connection, supplied);
  // Reused sockets are what keep a listing of a thousand keys from being a
  // thousand handshakes against an endpoint that may be doing mTLS.
  const agentOptions: https.AgentOptions = { keepAlive: true, ...options };
  return connection.tls.pinnedSha256
    ? new PinnedAgent(agentOptions, connection.tls.pinnedSha256)
    : new https.Agent(agentOptions);
}

/**
 * Credentials for the endpoint.
 *
 * Anonymous is not "empty credentials": the SDK would sign with them and the
 * endpoint would refuse a signature it cannot verify, so the signing step is
 * replaced by one that leaves the request alone. Public read only buckets are
 * the case, and they are common enough on prem to be worth supporting.
 */
async function credentialsFor(
  connection: S3Connection,
  supplied: S3Credential | null,
): Promise<
  | { credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string } }
  | { credentials: ReturnType<typeof fromNodeProviderChain> }
  | { signer: { sign: <T>(request: T) => Promise<T> } }
> {
  switch (connection.credentials.mode) {
    case "anonymous":
      return { signer: { sign: (request) => Promise.resolve(request) } };
    case "aws-profile":
      return { credentials: fromNodeProviderChain({ profile: connection.credentials.profile }) };
    default: {
      const credential = await credentialOrStored(connection, supplied);
      if (!credential?.secretAccessKey) {
        throw new AwsRequestError(
          `The credential for "${connection.name}" is missing; add its keys again.`,
          { code: "BadConfiguration", service: "s3" },
        );
      }
      return {
        credentials: {
          accessKeyId: credential.accessKeyId,
          secretAccessKey: credential.secretAccessKey,
          ...(credential.sessionToken ? { sessionToken: credential.sessionToken } : {}),
        },
      };
    }
  }
}

/**
 * Restates a refused certificate as the decision it is.
 *
 * The SDK reports one as a transport failure, which reads like the endpoint is
 * down; nothing about a credential or a bucket name changes the outcome, so the
 * error says what was refused and where.
 */
function reportTrustFailures(client: S3Client, endpoint: string): void {
  client.middlewareStack.add(
    (next) => async (args) => {
      try {
        return await next(args);
      } catch (err) {
        const reason = trustReason(err);
        if (reason) throw new EndpointTrustError(endpoint, reason);
        throw err;
      }
    },
    { step: "finalizeRequest", name: "fawsEndpointTrust" },
  );
}

export async function buildEndpointClient(
  connection: S3Connection,
  supplied: S3Credential | null = null,
): Promise<S3Client> {
  const auth = await credentialsFor(connection, supplied);
  const isHttps = connection.endpoint.startsWith("https:");

  const client = new S3Client({
    endpoint: connection.endpoint,
    region: connection.region,
    forcePathStyle: connection.forcePathStyle,
    // A bucket outside AWS has no other region to be redirected to, and the
    // redirect chase costs an extra request against servers that answer 301
    // for reasons of their own.
    followRegionRedirects: false,
    // A checksum computed at signing time is computed over no body, so S3 then
    // measures the real bytes against it and every presigned upload fails.
    requestChecksumCalculation: "WHEN_REQUIRED",
    ...auth,
    ...(isHttps
      ? {
          requestHandler: new NodeHttpHandler({
            httpsAgent: await agentFor(connection, supplied),
          }),
        }
      : {}),
  });

  if (isHttps) reportTrustFailures(client, connection.endpoint);
  return client;
}

/** Clients keyed by connection and revision, so an edit is never cached over. */
const clients = new Map<string, S3Client>();

export async function endpointClient(connection: S3Connection): Promise<S3Client> {
  const key = `${connection.id}::${connection.revision}`;
  const existing = clients.get(key);
  if (existing) return existing;

  const client = await buildEndpointClient(connection);
  // A saved edit leaves the previous revision's client holding open sockets.
  for (const [cached, stale] of clients) {
    if (cached.startsWith(`${connection.id}::`)) {
      stale.destroy();
      clients.delete(cached);
    }
  }
  clients.set(key, client);
  return client;
}

/** Drops a connection's client, for a delete or a credential that changed. */
export function invalidateConnection(id: string): void {
  for (const [key, client] of clients) {
    if (key.startsWith(`${id}::`)) {
      client.destroy();
      clients.delete(key);
    }
  }
}
