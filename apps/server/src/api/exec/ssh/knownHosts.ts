/**
 * Reading and writing `~/.ssh/known_hosts`.
 *
 * This is the file that decides whether a host is who it says it is, so every
 * ambiguity here resolves toward refusing rather than trusting. Specifically:
 *
 * - A line we cannot parse **fails the connection**. The reference
 *   implementation this replaces returned "ok" when its key parser threw, which
 *   silently trusted anything it did not understand - the exact shape of bug
 *   this file exists to not have.
 * - A key that does not match a recorded one is a hard failure with no
 *   "continue anyway" path. That is what a changed host key means everywhere
 *   else, and offering a one-click override would undo the point of checking.
 * - Hashed entries (`|1|salt|hash`) are understood. Anyone with
 *   `HashKnownHosts yes` - the default on many distributions - would otherwise
 *   look like a first-time connection on every connect, and get a duplicate
 *   entry appended each time.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type HostKeyVerdict =
  | { outcome: "trusted" }
  | { outcome: "unknown" }
  | { outcome: "changed"; file: string; line: number }
  | { outcome: "revoked" }
  | { outcome: "unparseable"; file: string; line: number };

interface Entry {
  readonly lineNumber: number;
  readonly marker: "revoked" | "cert-authority" | null;
  readonly patterns: string;
  readonly keyType: string;
  readonly key: string;
}

export function defaultKnownHostsPath(): string {
  return path.join(os.homedir(), ".ssh", "known_hosts");
}

/**
 * The name a host is recorded under.
 *
 * The bracketed form is only used for non-default ports, which is what ssh
 * itself does - writing `[host]:22` would not match what ssh wrote.
 */
export function hostPattern(host: string, port: number): string {
  return port === 22 ? host : `[${host}]:${port}`;
}

function parseLine(raw: string, lineNumber: number): Entry | "skip" | "bad" {
  const line = raw.trim();
  if (line.length === 0 || line.startsWith("#")) return "skip";

  let rest = line;
  let marker: Entry["marker"] = null;
  if (rest.startsWith("@")) {
    const [markerToken, ...tail] = rest.split(/\s+/);
    if (markerToken === "@revoked") marker = "revoked";
    else if (markerToken === "@cert-authority") marker = "cert-authority";
    else return "bad";
    rest = tail.join(" ");
  }

  const [patterns, keyType, key] = rest.split(/\s+/);
  if (!patterns || !keyType || !key) return "bad";
  return { lineNumber, marker, patterns, keyType, key };
}

/** `|1|<base64 salt>|<base64 hash>` - HMAC-SHA1 of the host under the salt. */
function hashedMatches(pattern: string, host: string): boolean {
  const parts = pattern.split("|");
  if (parts.length !== 4 || parts[1] !== "1") return false;
  const [, , salt, expected] = parts;
  if (!salt || !expected) return false;
  try {
    const mac = crypto.createHmac("sha1", Buffer.from(salt, "base64"));
    mac.update(host);
    return mac.digest("base64") === expected;
  } catch {
    return false;
  }
}

function patternMatches(patterns: string, host: string): boolean {
  for (const pattern of patterns.split(",")) {
    if (pattern.startsWith("|")) {
      if (hashedMatches(pattern, host)) return true;
      continue;
    }
    if (pattern === host) return true;
    // Wildcards, as ssh_config globs them.
    if (pattern.includes("*") || pattern.includes("?")) {
      const expression = pattern.replaceAll(".", "\\.").replaceAll("*", ".*").replaceAll("?", ".");
      if (new RegExp(`^${expression}$`).test(host)) return true;
    }
  }
  return false;
}

/** Key material is base64 in this file; anything else is a corrupt line. */
function isBase64(value: string): boolean {
  return value.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export function readKnownHosts(file: string): string[] {
  try {
    return fs.readFileSync(file, "utf8").split("\n");
  } catch {
    // No file yet is the same as no entries: every host is a first contact.
    return [];
  }
}

/**
 * Checks a host key against the file's contents.
 *
 * Takes the lines rather than a path so the decision table is testable without
 * touching a filesystem.
 */
export function verifyHostKey(
  lines: ReadonlyArray<string>,
  file: string,
  host: string,
  port: number,
  keyType: string,
  keyBase64: string,
): HostKeyVerdict {
  const names = [hostPattern(host, port), host];
  let sawHost = false;
  let firstMismatchLine = 0;

  for (const [index, raw] of lines.entries()) {
    const parsed = parseLine(raw, index + 1);
    if (parsed === "skip") continue;
    if (parsed === "bad") {
      // Only a line that could match this host matters, but we cannot know
      // which host an unparseable line is for - so it fails closed.
      return { outcome: "unparseable", file, line: index + 1 };
    }
    if (!names.some((name) => patternMatches(parsed.patterns, name))) continue;

    // From here the line is about this host, so a key we cannot read is not
    // something to skip past - we would fall through to "unknown" and offer to
    // trust a host that already has a recorded key.
    if (!isBase64(parsed.key)) {
      return { outcome: "unparseable", file, line: parsed.lineNumber };
    }

    // A CA entry signs other keys rather than being one; verifying against it
    // needs certificate support we do not have, so it is not a match either way.
    if (parsed.marker === "cert-authority") continue;

    if (parsed.keyType === keyType && parsed.key === keyBase64) {
      return parsed.marker === "revoked" ? { outcome: "revoked" } : { outcome: "trusted" };
    }
    if (parsed.marker === "revoked") continue;

    // Same host, same algorithm, different key: this is the case that matters.
    if (parsed.keyType === keyType) {
      sawHost = true;
      firstMismatchLine ||= parsed.lineNumber;
    }
  }

  return sawHost ? { outcome: "changed", file, line: firstMismatchLine } : { outcome: "unknown" };
}

export function knownHostsLine(
  host: string,
  port: number,
  keyType: string,
  keyBase64: string,
): string {
  return `${hostPattern(host, port)} ${keyType} ${keyBase64}`;
}

/**
 * Appends a newly trusted host.
 *
 * Append-only and never read-modify-write: `ssh` may be writing to this file at
 * the same moment, and rewriting it from a copy we read earlier would drop
 * whatever it added in between.
 */
export function appendKnownHost(file: string, line: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.appendFileSync(file, `${line}\n`, { mode: 0o600 });
}

/** `SHA256:...`, the fingerprint form ssh shows and people compare. */
export function fingerprint(keyBase64: string): string {
  const digest = crypto
    .createHash("sha256")
    .update(Buffer.from(keyBase64, "base64"))
    .digest("base64");
  return `SHA256:${digest.replace(/=+$/, "")}`;
}
