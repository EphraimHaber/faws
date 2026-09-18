/**
 * The saved S3 endpoints, and the line between a record and a credential.
 *
 * Every write goes through here so the line holds in one place: what an
 * endpoint is gets stored as a record, and what it takes to prove who you are
 * gets stored as a credential the record points at. Nothing here ever returns
 * a credential - a caller that needs one asks the credential store, and a
 * caller that is only describing endpoints never sees one.
 */
import type {
  S3Connection,
  S3ConnectionCredentials,
  S3ConnectionInput,
  S3ConnectionTls,
  S3Credential,
  S3Scope,
} from "@faws/contracts";
import { AwsRequestError, ConnectionNotFoundError } from "@faws/contracts";

import { connectionStore, credentialStore } from "./store.ts";

export async function getConnection(id: string): Promise<S3Connection> {
  const stored = await connectionStore().get(id);
  if (!stored) throw new ConnectionNotFoundError(id);
  return stored;
}

/** The connection a scope points at, or null when it points at AWS. */
export async function connectionFor(scope: S3Scope): Promise<S3Connection | null> {
  if (!scope.connectionId) return null;
  return getConnection(scope.connectionId);
}

/** The credential an endpoint names, if it names one that is still there. */
export async function credentialFor(connection: S3Connection): Promise<S3Credential | null> {
  if (connection.credentials.mode !== "stored") return null;
  return credentialStore().read(connection.credentials.ref);
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
 * The credential a form describes, merged onto whatever is already stored.
 *
 * A blank field means the stored value stands, which is what lets a form edit
 * an endpoint without ever being handed the key it is editing: the fields
 * start empty because nothing was sent to fill them.
 */
export function mergeCredential(
  input: S3ConnectionInput,
  existing: S3Credential | null,
): S3Credential {
  const sessionToken = input.sessionToken?.trim() || existing?.sessionToken;
  const passphrase = input.clientKeyPassphrase?.trim() || existing?.clientKeyPassphrase;
  return {
    accessKeyId: input.accessKeyId?.trim() || existing?.accessKeyId || "",
    secretAccessKey: input.secretAccessKey?.trim() || existing?.secretAccessKey || "",
    ...(sessionToken ? { sessionToken } : {}),
    ...(passphrase ? { clientKeyPassphrase: passphrase } : {}),
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
    name: input.name,
    endpoint: input.endpoint,
    region: input.region,
    forcePathStyle: input.forcePathStyle,
    credentials: credentialsOf(input, existing),
    tls: tlsOf(input),
    features: input.features,
    revision: existing?.revision ?? 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

/**
 * Which credential the record names.
 *
 * An endpoint keeps the reference it already had, so re-saving one does not
 * strand the credential it was using under a reference nothing points at.
 */
function credentialsOf(
  input: S3ConnectionInput,
  existing: S3Connection | null,
): S3ConnectionCredentials {
  switch (input.credentialMode) {
    case "aws-profile":
      return { mode: "aws-profile", profile: input.profile ?? "default" };
    case "anonymous":
      return { mode: "anonymous" };
    default: {
      const ref =
        existing?.credentials.mode === "stored" ? existing.credentials.ref : crypto.randomUUID();
      return { mode: "stored", ref };
    }
  }
}

export async function saveConnection(input: S3ConnectionInput): Promise<S3Connection> {
  const store = connectionStore();
  const existing = input.id ? await store.get(input.id) : null;
  if (input.id && !existing) throw new ConnectionNotFoundError(input.id);

  const id = existing?.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const credentials = credentialsOf(input, existing);

  if (credentials.mode === "stored") {
    const current = existing ? await credentialFor(existing) : null;
    const credential = mergeCredential(input, current);
    // The schema can only require both halves for a connection that has no id;
    // an endpoint switching to stored keys has one and nothing stored behind
    // it, and saving that writes a credential no request can use.
    if (!credential.accessKeyId || !credential.secretAccessKey) {
      throw new AwsRequestError("Enter an access key id and a secret access key.", {
        code: "BadConfiguration",
        service: "s3",
      });
    }
    await credentialStore().write(credentials.ref, credential);
  } else if (existing?.credentials.mode === "stored") {
    // The endpoint no longer signs with it, and a credential nothing points at
    // is a key kept for no one.
    await credentialStore().remove(existing.credentials.ref);
  }

  const connection: S3Connection = {
    id,
    name: input.name,
    endpoint: input.endpoint,
    region: input.region,
    forcePathStyle: input.forcePathStyle,
    credentials,
    tls: tlsOf(input),
    features: input.features,
    revision: (existing?.revision ?? 0) + 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await store.put(connection);
  return connection;
}

export async function deleteConnection(id: string): Promise<void> {
  const store = connectionStore();
  const existing = await store.get(id);
  await store.remove(id);
  if (existing?.credentials.mode === "stored") {
    await credentialStore().remove(existing.credentials.ref);
  }
}
