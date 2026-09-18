/**
 * Testing an endpoint before trusting it with anything.
 *
 * The handshake is made once with verification forced off, not to accept the
 * certificate but to be able to show it: an operator deciding whether to add a
 * CA or pin a fingerprint needs to see the subject, the issuer and the
 * fingerprint of what is actually answering, and a connection that is refused
 * before that point shows them nothing to decide with. Nothing here writes a
 * trust decision anywhere; it reports, and the decision is saved separately.
 */
import * as tls from "node:tls";

import { ListBucketsCommand } from "@aws-sdk/client-s3";
import type { S3ConnectionInput, S3ConnectionProbe, S3ProbeTls } from "@faws/contracts";

import { draftConnection } from "./connections.ts";
import { buildEndpointClient, type SecretOverrides, tlsOptionsFor } from "./endpointClient.ts";

/** Long enough for a busy endpoint, short enough to fail a wrong host fast. */
const TIMEOUT_MS = 8000;

function distinguishedName(parts: tls.PeerCertificate["subject"] | undefined): string {
  if (!parts) return "";
  return Object.entries(parts)
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join("+") : String(value)}`)
    .join(", ");
}

async function probeTls(
  endpoint: URL,
  options: tls.ConnectionOptions,
  pinnedSha256: string | null,
): Promise<S3ProbeTls> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host: endpoint.hostname,
        port: Number(endpoint.port || 443),
        servername: endpoint.hostname,
        ...options,
        rejectUnauthorized: false,
      },
      () => {
        const cert = socket.getPeerCertificate();
        const fingerprint = cert.fingerprint256 ?? "";
        const pinMatches =
          pinnedSha256 !== null &&
          fingerprint.replaceAll(":", "").toUpperCase() ===
            pinnedSha256.replaceAll(":", "").toUpperCase();

        resolve({
          // A pin answers the question the chain would otherwise answer, so a
          // certificate that matches one is trusted whether or not a CA vouches
          // for it - that is what pinning a self signed certificate is for.
          trusted: pinnedSha256 === null ? socket.authorized : pinMatches,
          error:
            pinnedSha256 !== null && !pinMatches
              ? "The certificate does not match the pinned fingerprint."
              : (socket.authorizationError?.message ??
                (socket.authorizationError ? String(socket.authorizationError) : null)),
          subject: distinguishedName(cert.subject),
          issuer: distinguishedName(cert.issuer),
          validFrom: cert.valid_from ?? "",
          validTo: cert.valid_to ?? "",
          fingerprintSha256: fingerprint,
          // An issuer equal to the subject is the whole of what "self signed"
          // means here, and it is the case a CA file cannot fix.
          selfSigned: distinguishedName(cert.issuer) === distinguishedName(cert.subject),
        });
        socket.destroy();
      },
    );

    socket.setTimeout(TIMEOUT_MS, () => {
      socket.destroy(new Error(`No answer from ${endpoint.host} within ${TIMEOUT_MS / 1000}s.`));
    });
    socket.on("error", reject);
  });
}

/**
 * The keys the form carries, which are the ones being tested.
 *
 * A blank field means the stored secret is being kept, so it is left out
 * rather than passed on as an empty credential.
 */
function suppliedSecrets(input: S3ConnectionInput): SecretOverrides {
  return {
    ...(input.secretAccessKey?.trim() ? { secretAccessKey: input.secretAccessKey.trim() } : {}),
    ...(input.sessionToken?.trim() ? { sessionToken: input.sessionToken.trim() } : {}),
    ...(input.clientKeyPassphrase?.trim()
      ? { clientKeyPassphrase: input.clientKeyPassphrase.trim() }
      : {}),
  };
}

export async function probeConnection(input: S3ConnectionInput): Promise<S3ConnectionProbe> {
  const overrides = suppliedSecrets(input);
  const connection = await draftConnection(input);
  const endpoint = new URL(connection.endpoint);

  let tlsResult: S3ProbeTls | null = null;
  let reachable = endpoint.protocol === "http:";

  if (endpoint.protocol === "https:") {
    try {
      const options = await tlsOptionsFor(connection, overrides);
      tlsResult = await probeTls(endpoint, options, connection.tls.pinnedSha256);
      reachable = true;
    } catch (err) {
      return {
        reachable: false,
        tls: null,
        s3: {
          ok: false,
          bucketCount: null,
          error: err instanceof Error ? err.message : String(err),
          code: (err as { code?: string }).code ?? null,
        },
      };
    }
  }

  const client = await buildEndpointClient(connection, overrides);
  try {
    const result = await client.send(new ListBucketsCommand({}));
    return {
      reachable: true,
      tls: tlsResult,
      s3: { ok: true, bucketCount: (result.Buckets ?? []).length, error: null, code: null },
    };
  } catch (err) {
    return {
      reachable,
      tls: tlsResult,
      s3: {
        ok: false,
        bucketCount: null,
        error: err instanceof Error ? err.message : String(err),
        code: (err as { name?: string }).name ?? null,
      },
    };
  } finally {
    client.destroy();
  }
}
