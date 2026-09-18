/**
 * Where settings live.
 *
 * Nothing in this package knows how a setting is persisted. It knows the two
 * shapes it needs - a record it can send anywhere, and a secret it cannot -
 * and a host registers an implementation that puts them wherever that host
 * keeps such things, which for a secret is not the same place as the record.
 *
 * The default implementation holds both in memory, so a build with no host
 * store still runs: a connection can be added, used and tested, and is gone
 * on restart.
 */
import type { S3Connection, S3ConnectionSecret } from "@faws/contracts";

/** Secrets are addressed by connection so a host can group or scope them. */
export interface SecretRef {
  readonly connectionId: string;
  readonly name: S3ConnectionSecret;
}

export interface SettingsStore {
  listS3Connections(): Promise<S3Connection[]>;
  getS3Connection(id: string): Promise<S3Connection | null>;
  putS3Connection(connection: S3Connection): Promise<void>;
  deleteS3Connection(id: string): Promise<void>;

  readSecret(ref: SecretRef): Promise<string | null>;
  /** A null value deletes the secret rather than storing an empty one. */
  writeSecret(ref: SecretRef, value: string | null): Promise<void>;
  deleteSecrets(connectionId: string): Promise<void>;
}

function secretKey(ref: SecretRef): string {
  return `${ref.connectionId}::${ref.name}`;
}

export function createMemorySettingsStore(): SettingsStore {
  const connections = new Map<string, S3Connection>();
  const secrets = new Map<string, string>();

  return {
    listS3Connections: () => Promise.resolve([...connections.values()]),
    getS3Connection: (id) => Promise.resolve(connections.get(id) ?? null),
    putS3Connection: (connection) => {
      connections.set(connection.id, connection);
      return Promise.resolve();
    },
    deleteS3Connection: (id) => {
      connections.delete(id);
      return Promise.resolve();
    },
    readSecret: (ref) => Promise.resolve(secrets.get(secretKey(ref)) ?? null),
    writeSecret: (ref, value) => {
      if (value === null) secrets.delete(secretKey(ref));
      else secrets.set(secretKey(ref), value);
      return Promise.resolve();
    },
    deleteSecrets: (connectionId) => {
      for (const key of secrets.keys()) {
        if (key.startsWith(`${connectionId}::`)) secrets.delete(key);
      }
      return Promise.resolve();
    },
  };
}

let store: SettingsStore = createMemorySettingsStore();

/**
 * Installs the store everything else reads through.
 *
 * Called once during startup, before anything has been read; a later swap
 * would leave whatever was written in the meantime behind in the old one.
 */
export function registerSettingsStore(next: SettingsStore): void {
  store = next;
}

export function settingsStore(): SettingsStore {
  return store;
}
