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
import { ConnectionNotFoundError } from "@faws/contracts";

import { settingsStore } from "../settings/store.ts";

const SECRET_NAMES: readonly S3ConnectionSecret[] = [
  "secretAccessKey",
  "sessionToken",
  "clientKeyPassphrase",
];

/**
 * A connection described by the environment.
 *
 * It exists so a container or a CI run can be pointed at an on prem endpoint
 * without a UI, and so this works before anything has been saved. It is seeded
 * once and then editable like any other: a saved connection under this id
 * wins, because otherwise the environment would silently undo every edit.
 */
const ENV_ID = "env";

function envConnection(): { connection: S3Connection; secret: string | null } | null {
  const endpoint = process.env["FAWS_S3_ENDPOINT"];
  if (!endpoint) return null;

  const accessKeyId = process.env["FAWS_S3_ACCESS_KEY_ID"];
  const caPath = process.env["FAWS_S3_CA_BUNDLE"];
  const now = new Date().toISOString();

  return {
    connection: {
      id: ENV_ID,
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
      createdAt: now,
      updatedAt: now,
    },
    secret: process.env["FAWS_S3_SECRET_ACCESS_KEY"] ?? null,
  };
}

let seeded = false;

async function seedFromEnv(): Promise<void> {
  if (seeded) return;
  seeded = true;

  const fromEnv = envConnection();
  if (!fromEnv) return;

  const store = settingsStore();
  if (await store.getS3Connection(ENV_ID)) return;

  await store.putS3Connection(fromEnv.connection);
  if (fromEnv.secret) {
    await store.writeSecret({ connectionId: ENV_ID, name: "secretAccessKey" }, fromEnv.secret);
  }
}

export async function listConnections(): Promise<S3Connection[]> {
  await seedFromEnv();
  const all = await settingsStore().listS3Connections();
  return all.toSorted((a, b) => a.name.localeCompare(b.name));
}

export async function getConnection(id: string): Promise<S3Connection> {
  await seedFromEnv();
  const connection = await settingsStore().getS3Connection(id);
  if (!connection) throw new ConnectionNotFoundError(id);
  return connection;
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
  const existing = input.id ? await settingsStore().getS3Connection(input.id) : null;
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? "",
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
  const store = settingsStore();
  const existing = input.id ? await store.getS3Connection(input.id) : null;
  if (input.id && !existing) throw new ConnectionNotFoundError(input.id);

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

  await store.putS3Connection(connection);
  return connection;
}

export async function deleteConnection(id: string): Promise<void> {
  const store = settingsStore();
  await store.deleteS3Connection(id);
  await store.deleteSecrets(id);
}

export async function connectionSecret(
  connection: S3Connection,
  name: S3ConnectionSecret,
): Promise<string | null> {
  if (!connection.secretKeys.includes(name)) return null;
  return settingsStore().readSecret({ connectionId: connection.id, name });
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
