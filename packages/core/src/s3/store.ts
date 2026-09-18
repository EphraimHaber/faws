/**
 * Where saved S3 endpoints and their secrets are kept.
 *
 * Nothing in this package knows how either is persisted. It knows the two
 * shapes it needs - a record it can send anywhere, and a secret it cannot -
 * and a host registers an implementation that puts them wherever that host
 * keeps such things, which for a secret is not the same place as the record.
 *
 * The default implementation holds both in memory, so a build with no host
 * store still runs: an endpoint can be added, used and tested, and is gone on
 * restart.
 */
import type { S3Connection, S3ConnectionSecret } from "@faws/contracts";

/** Secrets are addressed by connection so a host can group or scope them. */
export interface SecretRef {
  readonly connectionId: string;
  readonly name: S3ConnectionSecret;
}

export interface S3ConnectionStore {
  list(): Promise<S3Connection[]>;
  get(id: string): Promise<S3Connection | null>;
  put(connection: S3Connection): Promise<void>;
  remove(id: string): Promise<void>;

  readSecret(ref: SecretRef): Promise<string | null>;
  /** A null value deletes the secret rather than storing an empty one. */
  writeSecret(ref: SecretRef, value: string | null): Promise<void>;
  removeSecrets(connectionId: string): Promise<void>;
}

function secretKey(ref: SecretRef): string {
  return `${ref.connectionId}::${ref.name}`;
}

export function createMemoryConnectionStore(): S3ConnectionStore {
  const connections = new Map<string, S3Connection>();
  const secrets = new Map<string, string>();

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
    readSecret: (ref) => Promise.resolve(secrets.get(secretKey(ref)) ?? null),
    writeSecret: (ref, value) => {
      if (value === null) secrets.delete(secretKey(ref));
      else secrets.set(secretKey(ref), value);
      return Promise.resolve();
    },
    removeSecrets: (connectionId) => {
      for (const key of secrets.keys()) {
        if (key.startsWith(`${connectionId}::`)) secrets.delete(key);
      }
      return Promise.resolve();
    },
  };
}

let store: S3ConnectionStore = createMemoryConnectionStore();

/**
 * Installs the store everything else reads through.
 *
 * Called once during startup, before anything has been read; a later swap
 * would leave whatever was written in the meantime behind in the old one.
 */
export function registerConnectionStore(next: S3ConnectionStore): void {
  store = next;
}

export function connectionStore(): S3ConnectionStore {
  return store;
}
