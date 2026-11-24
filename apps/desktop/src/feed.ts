/**
 * Where the update check reads releases from.
 *
 * GitHub Releases unless something names another place, in this order:
 * the FAWS_UPDATE_URL environment variable, a machine policy file only an
 * administrator can write, then the person's own setting. Any of them points
 * at a plain HTTP folder holding `latest.yml` and the installers beside it,
 * such as a Nexus raw repository or a GitLab generic package.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type FeedSource = "github" | "setting" | "policy" | "environment";

export interface Feed {
  readonly source: FeedSource;
  /** The folder's URL with a trailing slash; null for GitHub. */
  readonly url: string | null;
  /** Sent with every request to the folder, such as a Nexus read only login. */
  readonly headers: Readonly<Record<string, string>>;
}

export interface FeedPolicy {
  readonly url?: string;
  /** A whole Authorization header value, e.g. `Basic dXNlcjpwYXNz`. */
  readonly authorization?: string;
}

export const GITHUB_FEED: Feed = { source: "github", url: null, headers: {} };

/** An http(s) URL with a trailing slash, so file names resolve inside it; null otherwise. */
export function normalizeFeedUrl(raw: string | undefined): string | null {
  const text = raw?.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}

export function parsePolicy(raw: unknown): FeedPolicy {
  if (typeof raw !== "object" || raw === null) return {};
  const record = raw as Record<string, unknown>;
  return {
    ...(typeof record["url"] === "string" ? { url: record["url"] } : {}),
    ...(typeof record["authorization"] === "string"
      ? { authorization: record["authorization"] }
      : {}),
  };
}

export function resolveFeed(input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly policy: FeedPolicy;
  readonly setting: string;
}): Feed {
  const authorization = input.env["FAWS_UPDATE_AUTHORIZATION"] ?? input.policy.authorization;
  const headers = authorization ? { Authorization: authorization } : {};
  const candidates: ReadonlyArray<[FeedSource, string | undefined]> = [
    ["environment", input.env["FAWS_UPDATE_URL"]],
    ["policy", input.policy.url],
    ["setting", input.setting],
  ];
  for (const [source, raw] of candidates) {
    const url = normalizeFeedUrl(raw);
    if (url) return { source, url, headers };
  }
  return GITHUB_FEED;
}

/** Writable only by an administrator on each platform, so a person cannot override it. */
export function policyPath(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string {
  if (platform === "win32")
    return join(env["ProgramData"] ?? "C:\\ProgramData", "faws", "update-feed.json");
  if (platform === "darwin") return "/Library/Application Support/faws/update-feed.json";
  return "/etc/faws/update-feed.json";
}

/** A missing or unreadable file is no policy. */
export function readPolicy(path: string): FeedPolicy {
  try {
    return parsePolicy(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return {};
  }
}

/**
 * The file a person downloads by hand from a folder feed: the dmg where there
 * is one, since the zip beside it exists for the updater.
 */
export function manualDownloadUrl(
  feedUrl: string,
  files: ReadonlyArray<{ readonly url: string }>,
): string {
  const file = files.find((entry) => entry.url.endsWith(".dmg")) ?? files[0];
  return file ? new URL(file.url, feedUrl).href : feedUrl;
}
