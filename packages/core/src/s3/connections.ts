/**
 * The saved S3 connections, and the split between a record and its secrets.
 *
 * Every write goes through here so the split holds in one place: what is safe
 * to hand back to a caller is stored as a connection, and a key, a token or a
 * passphrase is stored as a secret and never returned - only the fact that one
 * is set, which is what a form needs to know to leave it alone.
 */
import type {
  S3Capabilities,
  S3Connection,
  S3ConnectionCredentials,
  S3ConnectionInput,
  S3ConnectionSecret,
  S3ConnectionTls,
  S3Scope,
} from "@faws/contracts";
import { ConnectionNotFoundError, ReadOnlyModeError } from "@faws/contracts";

import { connectionStore } from "./store.ts";

const SECRET_NAMES: readonly S3ConnectionSecret[] = [
  "secretAccessKey",
  "sessionToken",
  "clientKeyPassphrase",
];

/**
 * An endpoint described by the environment.
 *
 * It exists so a container or a CI run can be pointed at an on prem endpoint
 * without a UI. It is offered alongside the saved ones and editable by nobody:
 * it belongs to whoever started the process, and a change written over it
 * would last until the next restart and then silently revert.
 */
const ENV_ID = "env";

function envConnection(): S3Connection | null {
  const endpoint = process.env["FAWS_S3_ENDPOINT"];
  if (!endpoint) return null;

  const accessKeyId = process.env["FAWS_S3_ACCESS_KEY_ID"];
  const caPath = process.env["FAWS_S3_CA_BUNDLE"];
  // Fixed rather than the clock, so every read is the same record and nothing
  // downstream sees it as having just changed.
  const stamp = new Date(0).toISOString();

  return {
    id: ENV_ID,
    source: "environment",
    name: process.env["FAWS_S3_NAME"] ?? "Environment",
    endpoint,
    region: process.env["FAWS_S3_REGION"] ?? "us-east-1",
    forcePathStyle: process.env["FAWS_S3_FORCE_PATH_STYLE"] !== "0",
    credentials: accessKeyId
      ? { mode: "static", accessKeyId }
      : { mode: "aws-profile", profile: process.env["AWS_PROFILE"] ?? "default" },
    tls: {
      verify: process.env["FAWS_S3_TLS_VERIFY"] !== "0",
      caPaths: caPath ? [caPath] : [],
      caPem: null,
      clientCertPath: process.env["FAWS_S3_CLIENT_CERT"] ?? null,
      clientKeyPath: process.env["FAWS_S3_CLIENT_KEY"] ?? null,
      servername: process.env["FAWS_S3_TLS_SERVERNAME"] ?? null,
      pinnedSha256: process.env["FAWS_S3_TLS_FINGERPRINT"] ?? null,
    },
    features: { storageMetrics: false, presign: true },
    secretKeys: process.env["FAWS_S3_SECRET_ACCESS_KEY"] ? ["secretAccessKey"] : [],
    revision: 1,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/** Secrets for the environment's endpoint come from the environment too. */
function envSecret(name: S3ConnectionSecret): string | null {
  switch (name) {
    case "secretAccessKey":
      return process.env["FAWS_S3_SECRET_ACCESS_KEY"] ?? null;
    case "clientKeyPassphrase":
      return process.env["FAWS_S3_CLIENT_KEY_PASSPHRASE"] ?? null;
    default:
      return process.env["FAWS_S3_SESSION_TOKEN"] ?? null;
  }
}

export async function listConnections(): Promise<S3Connection[]> {
  const stored = await connectionStore().list();
  const fromEnv = envConnection();
  // A saved endpoint under the same id wins, so the environment cannot shadow
  // one that someone curated.
  const all =
    fromEnv && !stored.some((entry) => entry.id === fromEnv.id) ? [...stored, fromEnv] : stored;
  return all.toSorted((a, b) => a.name.localeCompare(b.name));
}

/** Only the ones the environment provides, which nothing can edit. */
export function environmentConnections(): S3Connection[] {
  const fromEnv = envConnection();
  return fromEnv ? [fromEnv] : [];
}

export async function getConnection(id: string): Promise<S3Connection> {
  const stored = await connectionStore().get(id);
  if (stored) return stored;
  const fromEnv = envConnection();
  if (fromEnv && fromEnv.id === id) return fromEnv;
  throw new ConnectionNotFoundError(id);
}

/** The connection a scope points at, or null when it points at AWS. */
export async function connectionFor(scope: S3Scope): Promise<S3Connection | null> {
  if (!scope.connectionId) return null;
  return getConnection(scope.connectionId);
}

function credentialsOf(input: S3ConnectionInput): S3ConnectionCredentials {
  switch (input.credentialMode) {
    case "aws-profile":
      return { mode: "aws-profile", profile: input.profile ?? "default" };
    case "anonymous":
      return { mode: "anonymous" };
    default:
      return { mode: "static", accessKeyId: input.accessKeyId ?? "" };
  }
}

function tlsOf(input: S3ConnectionInput): S3ConnectionTls {
  return {
    verify: input.tls.verify,
    caPaths: input.tls.caPaths,
    caPem: input.tls.caPem,
    clientCertPath: input.tls.clientCertPath,
    clientKeyPath: input.tls.clientKeyPath,
    servername: input.tls.servername,
    pinnedSha256: input.tls.pinnedSha256,
  };
}

/**
 * The record an input describes, without storing it.
 *
 * A test has to run against what is on screen, including an endpoint that has
 * never been saved and an edit that has not been saved yet.
 */
export async function draftConnection(input: S3ConnectionInput): Promise<S3Connection> {
  const existing = input.id ? await connectionStore().get(input.id) : null;
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? "",
    source: "stored",
    name: input.name,
    endpoint: input.endpoint,
    region: input.region,
    forcePathStyle: input.forcePathStyle,
    credentials: credentialsOf(input),
    tls: tlsOf(input),
    features: input.features,
    secretKeys: existing?.secretKeys ?? [],
    revision: existing?.revision ?? 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

/**
 * Creates or updates a connection.
 *
 * A blank secret leaves the stored one in place, which is what lets a form
 * round trip without ever holding what it is editing: the field starts empty
 * because nothing was sent to fill it, and saving from there has to mean
 * "unchanged" rather than "erase it".
 */
export async function saveConnection(input: S3ConnectionInput): Promise<S3Connection> {
  const store = connectionStore();
  const existing = input.id ? await store.get(input.id) : null;
  if (input.id && !existing) {
    if (envConnection()?.id === input.id) {
      throw new ReadOnlyModeError("editing an endpoint the environment set");
    }
    throw new ConnectionNotFoundError(input.id);
  }

  const id = existing?.id ?? crypto.randomUUID();
  const now = new Date().toISOString();

  const incoming: Record<S3ConnectionSecret, string | undefined> = {
    secretAccessKey: input.secretAccessKey,
    sessionToken: input.sessionToken,
    clientKeyPassphrase: input.clientKeyPassphrase,
  };

  const kept = new Set<S3ConnectionSecret>(existing?.secretKeys ?? []);
  for (const name of SECRET_NAMES) {
    const value = incoming[name]?.trim();
    if (!value) continue;
    await store.writeSecret({ connectionId: id, name }, value);
    kept.add(name);
  }

  // Credentials the connection no longer uses would otherwise sit in the
  // secret store with nothing referring to them.
  if (input.credentialMode !== "static") {
    for (const name of ["secretAccessKey", "sessionToken"] as const) {
      await store.writeSecret({ connectionId: id, name }, null);
      kept.delete(name);
    }
  }

  const connection: S3Connection = {
    id,
    source: "stored",
    name: input.name,
    endpoint: input.endpoint,
    region: input.region,
    forcePathStyle: input.forcePathStyle,
    credentials: credentialsOf(input),
    tls: tlsOf(input),
    features: input.features,
    secretKeys: [...kept],
    revision: (existing?.revision ?? 0) + 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await store.put(connection);
  return connection;
}

export async function deleteConnection(id: string): Promise<void> {
  const store = connectionStore();
  if (!(await store.get(id)) && envConnection()?.id === id) {
    throw new ReadOnlyModeError("removing an endpoint the environment set");
  }
  await store.remove(id);
  await store.removeSecrets(id);
}

export async function connectionSecret(
  connection: S3Connection,
  name: S3ConnectionSecret,
): Promise<string | null> {
  if (!connection.secretKeys.includes(name)) return null;
  if (connection.source === "environment") return envSecret(name);
  return connectionStore().readSecret({ connectionId: connection.id, name });
}

/**
 * What the UI may offer for a scope.
 *
 * A bucket outside AWS has no home region to resolve and no CloudWatch behind
 * it, and both of those drive panes that would otherwise spend a request per
 * open only to report a failure.
 */
export async function capabilitiesFor(scope: S3Scope): Promise<S3Capabilities> {
  const connection = await connectionFor(scope);
  if (!connection) return { bucketRegions: true, storageMetrics: true, presign: true };
  return {
    bucketRegions: false,
    storageMetrics: connection.features.storageMetrics,
    presign: connection.features.presign,
  };
}
