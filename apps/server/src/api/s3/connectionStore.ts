/**
 * Where S3 endpoints and their keys actually live on this machine.
 *
 * The records go in the settings file, which gets them versioning, atomic
 * writes and live sync to every open window for free. The keys deliberately do
 * not: that file is read by the renderer on first paint, broadcast on every
 * change, and is the file someone would paste into a bug report. They go in a
 * sibling nobody broadcasts, written 0600.
 *
 * Losing the secrets file is recoverable - the endpoint is still described,
 * and a key can be typed again. Losing it into a log is not, which is why the
 * split is at the storage layer rather than at the UI.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { registerConnectionStore, type S3ConnectionStore, type SecretRef } from "@faws/core";
import { settingsDir } from "@faws/shared/dataDir";

import { createLogger } from "../../shared/logger.ts";
import { writeSettingsFileAtomic } from "../settings/settings.file.ts";
import type { SettingsStore } from "../settings/settings.store.ts";
import { settingsStore } from "../settings/settings.instance.ts";

const log = createLogger("s3-connections");

export interface ConnectionStoreOptions {
  /** Where the records live. Defaults to this process's settings store. */
  readonly settings?: SettingsStore;
  /** Where the keys live. Defaults to a sibling of the settings file. */
  readonly secretsFile?: string;
}

function defaultSecretsFile(): string {
  return path.join(settingsDir(), "s3-secrets.json");
}

function secretKey(ref: SecretRef): string {
  return `${ref.connectionId}::${ref.name}`;
}

/** Anything that is not a string is not a secret this wrote. */
function readSecrets(raw: unknown): Map<string, string> {
  const entries = new Map<string, string>();
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return entries;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") entries.set(key, value);
  }
  return entries;
}

export function createServerConnectionStore(
  options: ConnectionStoreOptions = {},
): S3ConnectionStore {
  const settings = () => options.settings ?? settingsStore();
  const file = options.secretsFile ?? defaultSecretsFile();

  /**
   * Read once and kept in memory, because a client is built on the request
   * path and a key has to be there without a disk read per call.
   */
  let secrets: Map<string, string> | null = null;

  async function loaded(): Promise<Map<string, string>> {
    if (secrets) return secrets;
    try {
      secrets = readSecrets(JSON.parse(await fs.readFile(file, "utf8")));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        // An unreadable secrets file must not take the endpoints with it: the
        // connections still list, and the one that needs a key says so.
        log.error({ err, file }, "could not read stored S3 keys");
      }
      secrets = new Map();
    }
    return secrets;
  }

  async function persist(): Promise<void> {
    const current = await loaded();
    await writeSettingsFileAtomic(file, Object.fromEntries(current));
  }

  return {
    list: () => Promise.resolve([...settings().get().settings.s3.connections]),

    get: (id) =>
      Promise.resolve(
        settings()
          .get()
          .settings.s3.connections.find((entry) => entry.id === id) ?? null,
      ),

    put: (connection) => {
      settings().applyS3Connection({ op: "save", connection });
      return Promise.resolve();
    },

    remove: (id) => {
      settings().applyS3Connection({ op: "remove", id });
      return Promise.resolve();
    },

    async readSecret(ref) {
      return (await loaded()).get(secretKey(ref)) ?? null;
    },

    async writeSecret(ref, value) {
      const current = await loaded();
      const key = secretKey(ref);
      if (value === null) {
        if (!current.delete(key)) return;
      } else {
        if (current.get(key) === value) return;
        current.set(key, value);
      }
      await persist();
    },

    async removeSecrets(connectionId) {
      const current = await loaded();
      let changed = false;
      for (const key of current.keys()) {
        if (key.startsWith(`${connectionId}::`)) {
          current.delete(key);
          changed = true;
        }
      }
      if (changed) await persist();
    },
  };
}

/** Called once from `main.ts`, after the settings file has been loaded. */
export function registerServerConnectionStore(): void {
  registerConnectionStore(createServerConnectionStore());
}
