/**
 * Key and prefix arithmetic.
 *
 * S3 has no directories: a prefix is a string that happens to end in a slash,
 * and every notion of "folder" in the UI is derived here rather than in each
 * component that needs one.
 */

/** The last segment of a key, or of a prefix ignoring its trailing slash. */
export function keyName(key: string): string {
  const trimmed = key.endsWith("/") ? key.slice(0, -1) : key;
  const slash = trimmed.lastIndexOf("/");
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}

/** The prefix a key sits in, "" at the root. Always ends in a slash. */
export function parentPrefix(key: string): string {
  const trimmed = key.endsWith("/") ? key.slice(0, -1) : key;
  const slash = trimmed.lastIndexOf("/");
  return slash === -1 ? "" : trimmed.slice(0, slash + 1);
}

/** Every prefix from the root down to this one, for a breadcrumb trail. */
export function prefixTrail(prefix: string): Array<{ name: string; prefix: string }> {
  const trail: Array<{ name: string; prefix: string }> = [];
  let walked = "";
  for (const segment of prefix.split("/")) {
    if (segment.length === 0) continue;
    walked += `${segment}/`;
    trail.push({ name: segment, prefix: walked });
  }
  return trail;
}

/**
 * A prefix in the one form the rest of the code expects: no leading slash,
 * collapsed doubles, and a trailing slash unless it is the root.
 *
 * A leading slash is the most common way a pasted key fails to list anything,
 * because S3 would treat it as a first segment with an empty name.
 */
export function normalizePrefix(prefix: string): string {
  const collapsed = prefix.replaceAll(/\/{2,}/g, "/").replace(/^\//, "");
  if (collapsed.length === 0) return "";
  return collapsed.endsWith("/") ? collapsed : `${collapsed}/`;
}

/** Joins a prefix and a name into a key, tolerating either side's slashes. */
export function joinKey(prefix: string, name: string): string {
  return `${normalizePrefix(prefix)}${name.replace(/^\//, "")}`;
}
