/**
 * Writing a login into the person's own kubeconfig, the way `oc login` does,
 * so `oc` and `kubectl` in a terminal see the same clusters faws does.
 *
 * - The file is the first one in `KUBECONFIG`, else `~/.kube/config`.
 * - Names follow `oc`: cluster `api-host-com:6443`, user
 *   `<name>/api-host-com:6443`, context `<namespace>/api-host-com:6443/<name>`.
 * - Entries are upserted by name on the parsed document, so every other entry
 *   and every field this module does not know about survives as it was.
 * - Writes are atomic (a temp file renamed over the original), keep the
 *   file's mode (0600 for a new file), take the same `<file>.lock` client-go
 *   takes, and leave one `<file>.faws-backup` of the original before the first.
 * - `insecure-skip-tls-verify` is never written.
 */
import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { dumpYaml, KubeConfig, loadYaml } from "@kubernetes/client-node";

export type RawEntry = Record<string, unknown>;

export interface NamedEntry {
  name?: string;
  cluster?: RawEntry;
  user?: RawEntry;
  context?: RawEntry;
  [key: string]: unknown;
}

export interface RawKubeconfig {
  apiVersion?: string;
  kind?: string;
  clusters?: NamedEntry[];
  users?: NamedEntry[];
  contexts?: NamedEntry[];
  "current-context"?: string;
  [key: string]: unknown;
}

/** The file `oc login` would write: the first entry of `KUBECONFIG`, else `~/.kube/config`. */
export function targetKubeconfig(): string {
  const configured = process.env["KUBECONFIG"]?.trim();
  const first = configured?.split(path.delimiter).find(Boolean);
  return first ?? path.join(os.homedir(), ".kube", "config");
}

/** `https://api.ocp.example.com:6443` is `api-ocp-example-com:6443`; a port is always named. */
export function clusterNickname(server: string): string {
  const url = new URL(server);
  const port = url.port || (url.protocol === "http:" ? "80" : "443");
  return `${url.hostname}:${port}`.replaceAll(".", "-");
}

export function userNickname(username: string, cluster: string): string {
  return `${username}/${cluster}`;
}

export function contextNickname(namespace: string, cluster: string, username: string): string {
  return `${namespace}/${cluster}/${username}`;
}

export async function readKubeconfigFile(file: string): Promise<RawKubeconfig> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return emptyKubeconfig();
    throw err;
  }
  return parseKubeconfig(text);
}

export function parseKubeconfig(text: string): RawKubeconfig {
  if (text.trim() === "") return emptyKubeconfig();
  const doc = loadYaml<RawKubeconfig | null>(text);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("The kubeconfig is not a YAML mapping.");
  }
  return doc;
}

function emptyKubeconfig(): RawKubeconfig {
  return {
    apiVersion: "v1",
    kind: "Config",
    clusters: [],
    users: [],
    contexts: [],
    "current-context": "",
    preferences: {},
  };
}

export interface LoginEntry {
  readonly server: string;
  readonly username: string;
  readonly token: string;
  readonly namespace: string;
  /** PEM text to write as the cluster's `certificate-authority-data`; null leaves the entry's CA alone. */
  readonly certificateAuthority: string | null;
}

export interface WrittenLogin {
  readonly cluster: string;
  readonly user: string;
  readonly context: string;
}

/** Puts a login into a parsed kubeconfig, as `oc login` merges one, and makes it current. */
export function mergeLogin(doc: RawKubeconfig, entry: LoginEntry): WrittenLogin {
  const cluster = clusterNickname(entry.server);
  const user = userNickname(entry.username, cluster);
  const context = contextNickname(entry.namespace, cluster, entry.username);

  const clusterEntry = upsert((doc.clusters ??= []), cluster, "cluster");
  clusterEntry["server"] = entry.server;
  if (entry.certificateAuthority) {
    clusterEntry["certificate-authority-data"] = Buffer.from(entry.certificateAuthority).toString(
      "base64",
    );
    // A file path and inline data together make kubectl refuse the entry.
    delete clusterEntry["certificate-authority"];
  }

  const userEntry = upsert((doc.users ??= []), user, "user");
  userEntry["token"] = entry.token;

  const contextEntry = upsert((doc.contexts ??= []), context, "context");
  contextEntry["cluster"] = cluster;
  contextEntry["namespace"] = entry.namespace;
  contextEntry["user"] = user;

  doc["current-context"] = context;
  return { cluster, user, context };
}

/** Replaces, or with null removes, the token of one user entry. False when no entry has that name. */
export function setUserToken(doc: RawKubeconfig, user: string, token: string | null): boolean {
  const found = (doc.users ?? []).find((entry) => entry.name === user);
  if (!found) return false;
  const fields = (found.user ??= {});
  if (token === null) delete fields["token"];
  else fields["token"] = token;
  return true;
}

/** The token a user entry holds, or null. */
export function userToken(doc: RawKubeconfig, user: string): string | null {
  const token = (doc.users ?? []).find((entry) => entry.name === user)?.user?.["token"];
  return typeof token === "string" && token.length > 0 ? token : null;
}

/** Sets a cluster's inline CA, leaving everything else about it as it was. */
export function setClusterAuthority(doc: RawKubeconfig, cluster: string, pem: string): boolean {
  const found = (doc.clusters ?? []).find((entry) => entry.name === cluster);
  if (!found) return false;
  const fields = (found.cluster ??= {});
  fields["certificate-authority-data"] = Buffer.from(pem).toString("base64");
  delete fields["certificate-authority"];
  return true;
}

function upsert(list: NamedEntry[], name: string, key: "cluster" | "user" | "context"): RawEntry {
  let found = list.find((entry) => entry.name === name);
  if (!found) {
    found = { name };
    list.push(found);
  }
  return (found[key] ??= {});
}

const queues = new Map<string, Promise<unknown>>();

/**
 * Reads, changes and writes one kubeconfig, one change at a time per file in
 * this process and under client-go's lock file against `oc` and `kubectl`.
 */
export async function updateKubeconfig<T>(
  file: string,
  change: (doc: RawKubeconfig) => T,
): Promise<T> {
  const real = await realpathOrSelf(file);
  const previous = queues.get(real) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(() => withLock(real, () => rewrite(real, change)));
  queues.set(real, run);
  try {
    return await run;
  } finally {
    if (queues.get(real) === run) queues.delete(real);
  }
}

async function rewrite<T>(file: string, change: (doc: RawKubeconfig) => T): Promise<T> {
  const doc = await readKubeconfigFile(file);
  const result = change(doc);
  const text = dumpYaml(doc);

  // What is about to be written must load the way client libraries load it.
  const check = new KubeConfig();
  check.loadFromString(text, { onInvalidEntry: "filter" });

  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const existing = await fs.stat(file).catch(() => null);
  const mode = existing ? existing.mode & 0o777 : 0o600;
  if (existing) await backupOnce(file);

  const temp = path.join(dir, `.${path.basename(file)}.${randomBytes(6).toString("hex")}.tmp`);
  const handle = await fs.open(temp, "wx", 0o600);
  try {
    await handle.writeFile(text, "utf8");
    await handle.chmod(mode);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temp, file);
  } catch (err) {
    await fs.rm(temp, { force: true });
    throw err;
  }
  return result;
}

export function backupPath(file: string): string {
  return `${file}.faws-backup`;
}

async function backupOnce(file: string): Promise<void> {
  try {
    await fs.copyFile(file, backupPath(file), fs.constants.COPYFILE_EXCL);
    await fs.chmod(backupPath(file), 0o600);
  } catch (err) {
    if ((err as { code?: string }).code !== "EEXIST") throw err;
  }
}

const LOCK_WAIT_MS = 3000;

async function withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      await (await fs.open(lock, "wx", 0o600)).close();
      break;
    } catch (err) {
      if ((err as { code?: string }).code !== "EEXIST" || Date.now() > deadline) {
        throw new Error(
          (err as { code?: string }).code === "EEXIST"
            ? `${lock} is held by another program. If nothing else is changing your kubeconfig, delete it and try again.`
            : `Could not lock ${file}: ${(err as Error).message}`,
          { cause: err },
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    return await fn();
  } finally {
    await fs.rm(lock, { force: true });
  }
}

async function realpathOrSelf(file: string): Promise<string> {
  try {
    return await fs.realpath(file);
  } catch {
    return path.resolve(file);
  }
}
