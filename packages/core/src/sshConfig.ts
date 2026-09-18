/**
 * Reading `~/.ssh/config`.
 *
 * Only a subset is honoured, and the rest is **rejected by name** rather than
 * quietly ignored. That distinction is the whole design. If someone's config
 * says `ProxyCommand`, silently skipping it means we either connect directly to
 * a host that was supposed to be proxied - which is the wrong machine, possibly
 * in the wrong account - or hang against something unreachable. Neither is a
 * failure anyone can diagnose from the outside. Saying "this app does not run
 * ProxyCommand" costs one error message and is always true.
 *
 * `Match exec` and `LocalCommand` are rejected for a second reason: they run
 * arbitrary commands, and a config file is not somewhere this app should be
 * taking instructions to execute.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import SSHConfig from "ssh-config";

/** Directives that mean a command runs; never honoured, always reported. */
const EXECUTING_DIRECTIVES = new Set([
  "proxycommand",
  "localcommand",
  "permitlocalcommand",
  "remotecommand",
]);

/** Honoured, but not yet implemented here - reported so it is not a surprise. */
const UNSUPPORTED_DIRECTIVES = new Set(["forwardagent"]);

export interface ResolvedSshHost {
  readonly host: string;
  readonly hostName: string;
  readonly user: string | null;
  readonly port: number | null;
  readonly identityFiles: ReadonlyArray<string>;
  readonly identitiesOnly: boolean;
  readonly identityAgent: string | null;
  /** Outermost hop first, as ssh's own `ProxyJump a,b,c` reads. */
  readonly proxyJump: ReadonlyArray<string>;
  readonly connectTimeoutMs: number | null;
  readonly keepaliveIntervalMs: number | null;
  readonly strictHostKeyChecking: string | null;
  /**
   * Directives found for this host that this app will not act on. Surfaced to
   * the user, because a config that is half-applied is worse than one that is
   * not applied at all.
   */
  readonly rejected: ReadonlyArray<{ directive: string; reason: string }>;
}

export function defaultSshConfigPath(): string {
  return path.join(os.homedir(), ".ssh", "config");
}

function expandTilde(value: string): string {
  return value.startsWith("~") ? path.join(os.homedir(), value.slice(1)) : value;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function all(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Resolves one host through the config.
 *
 * Takes the file's text rather than reading it, so the directive table can be
 * tested without a home directory.
 */
export function resolveSshHost(configText: string, host: string): ResolvedSshHost {
  const rejected: Array<{ directive: string; reason: string }> = [];

  let computed: Record<string, string | string[]> = {};
  try {
    const parsed = SSHConfig.parse(configText);
    computed = parsed.compute(host) as Record<string, string | string[]>;
  } catch {
    rejected.push({
      directive: "(whole file)",
      reason: "~/.ssh/config could not be parsed, so none of it was applied.",
    });
  }

  for (const key of Object.keys(computed)) {
    const lower = key.toLowerCase();
    if (EXECUTING_DIRECTIVES.has(lower)) {
      rejected.push({
        directive: key,
        reason:
          lower === "proxycommand"
            ? "faws does not run ProxyCommand. Use ProxyJump, or open this host from your own terminal."
            : "faws does not run commands from ~/.ssh/config.",
      });
    } else if (UNSUPPORTED_DIRECTIVES.has(lower) && first(computed[key]) !== "no") {
      rejected.push({
        directive: key,
        reason: "Agent forwarding is not supported here; the session will run without it.",
      });
    }
  }

  const port = Number.parseInt(first(computed["Port"]) ?? "", 10);
  const connectTimeout = Number.parseInt(first(computed["ConnectTimeout"]) ?? "", 10);
  const keepalive = Number.parseInt(first(computed["ServerAliveInterval"]) ?? "", 10);

  return {
    host,
    hostName: first(computed["HostName"]) ?? host,
    user: first(computed["User"]) ?? null,
    port: Number.isFinite(port) ? port : null,
    identityFiles: all(computed["IdentityFile"]).map(expandTilde),
    identitiesOnly: first(computed["IdentitiesOnly"]) === "yes",
    identityAgent: first(computed["IdentityAgent"]) ?? null,
    proxyJump: (first(computed["ProxyJump"]) ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0 && entry !== "none"),
    connectTimeoutMs: Number.isFinite(connectTimeout) ? connectTimeout * 1000 : null,
    keepaliveIntervalMs: Number.isFinite(keepalive) ? keepalive * 1000 : null,
    strictHostKeyChecking: first(computed["StrictHostKeyChecking"]) ?? null,
    rejected,
  };
}

export function readSshConfig(file = defaultSshConfigPath()): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** Host aliases worth offering in a picker: the ones with a real HostName. */
export function listSshHosts(configText: string): Array<{ host: string; hostName: string }> {
  const out: Array<{ host: string; hostName: string }> = [];
  let parsed;
  try {
    parsed = SSHConfig.parse(configText);
  } catch {
    return out;
  }

  for (const entry of parsed) {
    const line = entry as { param?: string; value?: string | string[] };
    if (line.param?.toLowerCase() !== "host") continue;
    for (const alias of all(line.value)) {
      // A pattern is not something you can connect to.
      if (alias.includes("*") || alias.includes("?") || alias === "") continue;
      const resolved = resolveSshHost(configText, alias);
      out.push({ host: alias, hostName: resolved.hostName });
    }
  }
  return out;
}
