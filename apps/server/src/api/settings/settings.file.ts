/**
 * Everything that touches the filesystem for `settings.json`, and nothing else.
 *
 * Kept apart from the store so the store's rules - when to migrate, what to
 * broadcast, when to refuse a write - can be read and tested without a disk in
 * the picture, and so the disk's rules can be tested without a store.
 *
 * Two of those rules are worth stating up front:
 *
 * - **Writes are atomic.** A settings file is the only copy of preferences
 *   someone curated by hand, and a machine that loses power midway through a
 *   rewrite must find either the old file or the new one, never half of each.
 *   Temp file, fsync, rename.
 * - **An unreadable file is moved aside, not deleted.** It is still the user's
 *   data even when this process cannot make sense of it, and an operator
 *   should be able to hand it back.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Same as `recordings/`: this file holds profile names and resource ARNs. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** How many quarantined copies to keep before the oldest is dropped. */
const MAX_CORRUPT_COPIES = 3;

export interface ReadResult {
  /** Parsed JSON, before any migration or schema validation. */
  readonly raw: Record<string, unknown> | null;
  /** True when the file was absent - the normal first-run case, not an error. */
  readonly missing: boolean;
  /** Set when the file existed but could not be turned into an object. */
  readonly corruptedTo: string | null;
}

/**
 * Reads and quarantines in one step.
 *
 * Quarantining here rather than in the caller keeps the invariant local: by
 * the time this returns, the path is either holding something we understood or
 * holding nothing at all, so the next write cannot land on top of a file we
 * failed to read.
 */
export async function readSettingsFile(file: string): Promise<ReadResult> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if (isErrno(err, "ENOENT")) return { raw: null, missing: true, corruptedTo: null };
    throw err;
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("settings.json is not a JSON object");
    }
    return { raw: parsed as Record<string, unknown>, missing: false, corruptedTo: null };
  } catch {
    const corruptedTo = await quarantine(file);
    return { raw: null, missing: false, corruptedTo };
  }
}

/** Moves an unreadable file aside and prunes older copies. Never throws. */
async function quarantine(file: string): Promise<string | null> {
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const target = `${file}.corrupt-${stamp}`;
  try {
    await fs.rename(file, target);
  } catch {
    return null;
  }
  try {
    const dir = path.dirname(file);
    const base = `${path.basename(file)}.corrupt-`;
    const copies = (await fs.readdir(dir)).filter((name) => name.startsWith(base)).toSorted();
    for (const stale of copies.slice(0, Math.max(0, copies.length - MAX_CORRUPT_COPIES))) {
      await fs.unlink(path.join(dir, stale)).catch(() => undefined);
    }
  } catch {
    /* pruning is housekeeping; failing it must not fail the read */
  }
  return target;
}

/**
 * Writes `data` so that a reader sees all of it or none of it.
 *
 * The temp name carries the pid so two processes sharing a data directory
 * cannot collide on it - they will still race on the final rename, which is
 * last-writer-wins by design (see the store's header).
 */
export async function writeSettingsFileAtomic(file: string, data: unknown): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true, mode: DIR_MODE });
  const temp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}-${randomSuffix()}`);

  try {
    const handle = await fs.open(temp, "w", FILE_MODE);
    try {
      await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temp, file);
  } catch (err) {
    await fs.unlink(temp).catch(() => undefined);
    throw err;
  }

  // Without this the rename itself can be lost on a hard power cut. It fails
  // on filesystems that will not open a directory for reading, which is not a
  // reason to report the write as failed.
  try {
    const dirHandle = await fs.open(dir, "r");
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
  } catch {
    /* best effort */
  }
}

/**
 * Whether the settings directory can be created and written.
 *
 * Probed at boot so the Settings page can say so before the person changes
 * anything, rather than swallowing their first preference and telling them
 * later.
 */
export async function probeWritable(file: string): Promise<string | null> {
  const dir = path.dirname(file);
  try {
    await fs.mkdir(dir, { recursive: true, mode: DIR_MODE });
    await fs.access(dir, fs.constants.W_OK);
    return null;
  } catch (err) {
    return describeError(err);
  }
}

/**
 * "EACCES: permission denied, open ..." - the errno is what makes a bug report
 * actionable, so it is kept, but Node already puts it at the front of most
 * messages and repeating it reads like a stutter in the UI.
 */
export function describeError(err: unknown): string {
  if (!isErrnoLike(err)) return err instanceof Error ? err.message : String(err);
  return err.message.startsWith(`${err.code}:`) ? err.message : `${err.code}: ${err.message}`;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

function isErrnoLike(err: unknown): err is NodeJS.ErrnoException & { code: string } {
  return err instanceof Error && typeof (err as NodeJS.ErrnoException).code === "string";
}

function isErrno(err: unknown, code: string): boolean {
  return isErrnoLike(err) && err.code === code;
}
