/**
 * Where S3 endpoints and their credentials actually live on this machine.
 *
 * The records go in the settings file, which gets them versioning, atomic
 * writes and live sync to every open window for free. The credentials
 * deliberately do not: that file is read by the renderer on first paint,
 * broadcast on every change, and is the file someone pastes into a bug report.
 * They go in `credentials/s3.json`, a directory of its own, written 0600, that
 * nothing broadcasts and nothing reads on the way to painting a page.
 *
 * AWS's own credentials are not here at all - they stay in `~/.aws`, where the
 * SDK's provider chain finds them and where rotating them is one place rather
 * than two.
 */
import type { S3Credential, S3CredentialSummary } from "@faws/contracts";
import { AwsRequestError } from "@faws/contracts";
import {
  registerConnectionStores,
  type S3ConnectionStore,
  type S3CredentialStore,
} from "@faws/core";
import { s3CredentialsFile } from "@faws/shared/dataDir";

import { createLogger } from "../../shared/logger.ts";
import {
  describeError,
  readSettingsFile,
  writeSettingsFileAtomic,
} from "../settings/settings.file.ts";
import { settingsStore } from "../settings/settings.instance.ts";
import type { SettingsStore } from "../settings/settings.store.ts";

const log = createLogger("s3-connections");

/** The records: everything about an endpoint except how to authenticate. */
export function createSettingsConnectionStore(
  store: () => SettingsStore = settingsStore,
): S3ConnectionStore {
  return {
    list: () => Promise.resolve([...store().get().settings.s3.connections]),

    get: (id) =>
      Promise.resolve(
        store()
          .get()
          .settings.s3.connections.find((entry) => entry.id === id) ?? null,
      ),

    put: (connection) => {
      store().applyS3Connection({ op: "save", connection });
      return Promise.resolve();
    },

    remove: (id) => {
      store().applyS3Connection({ op: "remove", id });
      return Promise.resolve();
    },
  };
}

/** A stored entry, after the fields this version does not recognise are cut. */
function readCredential(raw: unknown): S3Credential | null {
  if (raw === null || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const accessKeyId = entry["accessKeyId"];
  const secretAccessKey = entry["secretAccessKey"];
  if (typeof accessKeyId !== "string" || typeof secretAccessKey !== "string") return null;
  const sessionToken = entry["sessionToken"];
  const clientKeyPassphrase = entry["clientKeyPassphrase"];
  return {
    accessKeyId,
    secretAccessKey,
    ...(typeof sessionToken === "string" ? { sessionToken } : {}),
    ...(typeof clientKeyPassphrase === "string" ? { clientKeyPassphrase } : {}),
  };
}

export function createFileCredentialStore(file: string = s3CredentialsFile()): S3CredentialStore {
  /**
   * Read once and kept in memory: a client is built on the request path, and a
   * key has to be there without a disk read per call.
   */
  let credentials: Map<string, S3Credential> | null = null;

  /**
   * Everything the file holds, or a failure that refuses to guess.
   *
   * The one thing this must never do is answer "no credentials" for a file it
   * could not read: the next save writes what is in memory, so a wrong empty
   * answer here is every other endpoint's key deleted. Unreadable JSON is
   * moved aside first - the path then really is empty, and the original is
   * still there to hand back - and a file that cannot be opened at all fails
   * the call instead.
   */
  async function loaded(): Promise<Map<string, S3Credential>> {
    if (credentials) return credentials;

    let result;
    try {
      result = await readSettingsFile(file);
    } catch (err) {
      throw new AwsRequestError(`Could not read the stored S3 credentials: ${describeError(err)}`, {
        code: "BadConfiguration",
        service: "s3",
      });
    }

    if (result.corruptedTo) {
      log.error(
        { file, movedTo: result.corruptedTo },
        "S3 credentials file was unreadable and has been moved aside",
      );
    }

    const entries = new Map<string, S3Credential>();
    for (const [ref, raw] of Object.entries(result.raw ?? {})) {
      const credential = readCredential(raw);
      if (credential) entries.set(ref, credential);
      else log.warn({ file, ref }, "dropped an unreadable S3 credential entry");
    }

    credentials = entries;
    return credentials;
  }

  async function persist(): Promise<void> {
    await writeSettingsFileAtomic(file, Object.fromEntries(await loaded()));
  }

  return {
    async read(ref) {
      return (await loaded()).get(ref) ?? null;
    },

    async write(ref, credential) {
      (await loaded()).set(ref, credential);
      await persist();
    },

    async remove(ref) {
      if (!(await loaded()).delete(ref)) return;
      await persist();
    },

    async summaries(): Promise<S3CredentialSummary[]> {
      return [...(await loaded())].map(([ref, credential]) => ({
        ref,
        accessKeyId: credential.accessKeyId,
        hasSessionToken: Boolean(credential.sessionToken),
        hasClientKeyPassphrase: Boolean(credential.clientKeyPassphrase),
      }));
    },
  };
}

/** Called once from `main.ts`, after the settings file has been loaded. */
export function registerServerConnectionStores(): void {
  registerConnectionStores({
    connections: createSettingsConnectionStore(),
    credentials: createFileCredentialStore(),
  });
}
