/**
 * Where saved S3 endpoints and their credentials are kept.
 *
 * Two stores, not one, because the two have different rules. A record is a
 * preference: it can be broadcast to every window, written to a file someone
 * quotes in a bug report, and read on first paint. A credential is none of
 * those things - it is the key itself, and the record only names it.
 *
 * Nothing in this package knows how either is persisted; a host registers an
 * implementation of each. The defaults hold both in memory, so a build with no
 * host store still runs: an endpoint can be added, used and tested, and is
 * gone on restart.
 */
import type { S3Connection, S3Credential, S3CredentialSummary } from "@faws/contracts";

/**
 * What a credential looks like from outside the store.
 *
 * Written once so no implementation can decide for itself how much of a
 * credential a summary carries.
 */
export function toCredentialSummary(ref: string, credential: S3Credential): S3CredentialSummary {
  return {
    ref,
    accessKeyId: credential.accessKeyId,
    hasSessionToken: Boolean(credential.sessionToken),
    hasClientKeyPassphrase: Boolean(credential.clientKeyPassphrase),
  };
}

/** The endpoint records, which carry no key material. */
export interface S3ConnectionStore {
  list(): Promise<S3Connection[]>;
  get(id: string): Promise<S3Connection | null>;
  put(connection: S3Connection): Promise<void>;
  remove(id: string): Promise<void>;
}

/**
 * The credentials the records point at.
 *
 * `summaries` is what a form is allowed to see: which credentials exist and
 * which key id each one is, never a secret half.
 */
export interface S3CredentialStore {
  read(ref: string): Promise<S3Credential | null>;
  write(ref: string, credential: S3Credential): Promise<void>;
  remove(ref: string): Promise<void>;
  summaries(): Promise<S3CredentialSummary[]>;
}

export function createMemoryConnectionStore(): S3ConnectionStore {
  const connections = new Map<string, S3Connection>();
  return {
    list: () => Promise.resolve([...connections.values()]),
    get: (id) => Promise.resolve(connections.get(id) ?? null),
    put: (connection) => {
      connections.set(connection.id, connection);
      return Promise.resolve();
    },
    remove: (id) => {
      connections.delete(id);
      return Promise.resolve();
    },
  };
}

export function createMemoryCredentialStore(): S3CredentialStore {
  const credentials = new Map<string, S3Credential>();
  return {
    read: (ref) => Promise.resolve(credentials.get(ref) ?? null),
    write: (ref, credential) => {
      credentials.set(ref, credential);
      return Promise.resolve();
    },
    remove: (ref) => {
      credentials.delete(ref);
      return Promise.resolve();
    },
    summaries: () =>
      Promise.resolve(
        [...credentials].map(([ref, credential]) => toCredentialSummary(ref, credential)),
      ),
  };
}

let connections: S3ConnectionStore = createMemoryConnectionStore();
let credentials: S3CredentialStore = createMemoryCredentialStore();

/**
 * Installs the stores everything else reads through.
 *
 * Called once during startup, before anything has been read; a later swap
 * would leave whatever was written in the meantime behind in the old one.
 */
export function registerConnectionStores(stores: {
  connections: S3ConnectionStore;
  credentials: S3CredentialStore;
}): void {
  connections = stores.connections;
  credentials = stores.credentials;
}

export function connectionStore(): S3ConnectionStore {
  return connections;
}

export function credentialStore(): S3CredentialStore {
  return credentials;
}
