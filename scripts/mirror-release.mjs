/**
 * Copies a faws release into an on-prem folder the app can update from, such
 * as a Nexus raw repository, including across an air gap.
 *
 *   node scripts/mirror-release.mjs fetch <tag|latest> <dir>
 *       Downloads every asset of a GitHub release into <dir> and verifies it.
 *       Run on the connected side.
 *
 *   node scripts/mirror-release.mjs verify <dir>
 *       Checks <dir> against SHA256SUMS and the sha512 of every file the
 *       latest*.yml manifests name. Run again after carrying it across.
 *
 *   node scripts/mirror-release.mjs push <dir> <folder-url>
 *       Verifies, then uploads every file with HTTP PUT into <folder-url>,
 *       the manifests last so no client sees one naming a file not there yet.
 *       Credentials come from MIRROR_USER and MIRROR_PASSWORD (Basic), or a
 *       whole header value in MIRROR_AUTHORIZATION.
 *
 * The app is then pointed at <folder-url> through its Update source setting,
 * FAWS_UPDATE_URL, or the machine policy file.
 *
 * Needs nothing but Node 20 or newer, so it runs inside the air gapped network.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, openAsBlob } from "node:fs";
import { mkdir, readdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const REPO = "EphraimHaber/faws";
/** electron-builder's own debug output, which a mirror has no use for. */
const SKIP = new Set(["builder-debug.yml"]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function hash(path, algorithm, encoding) {
  return new Promise((resolve, reject) => {
    const digest = createHash(algorithm);
    createReadStream(path)
      .on("error", reject)
      .on("data", (chunk) => digest.update(chunk))
      .on("end", () => resolve(digest.digest(encoding)));
  });
}

const isManifest = (name) => /^latest.*\.yml$/.test(name);

/** `files[].url` and `sha512` pairs from an electron-builder manifest. */
function manifestEntries(text) {
  return [...text.matchAll(/-\s+url:\s*(\S+)\s*\n\s+sha512:\s*(\S+)/g)].map(([, url, sha512]) => ({
    url,
    sha512,
  }));
}

async function verify(dir) {
  const names = (await readdir(dir)).filter((name) => !name.startsWith("."));
  let problems = 0;
  let checked = 0;

  if (names.includes("SHA256SUMS")) {
    const lines = (await readFile(join(dir, "SHA256SUMS"), "utf8")).split("\n").filter(Boolean);
    for (const line of lines) {
      const [expected, raw] = line.split(/\s+\*?/, 2);
      const name = raw?.trim();
      if (!name || SKIP.has(name)) continue;
      if (!names.includes(name)) {
        console.error(`missing   ${name}`);
        problems++;
        continue;
      }
      const actual = await hash(join(dir, name), "sha256", "hex");
      if (actual !== expected) {
        console.error(`MISMATCH  ${name} (sha256)`);
        problems++;
      } else checked++;
    }
  } else {
    console.warn("No SHA256SUMS in this release; checking the manifests' sha512 only.");
  }

  const manifests = names.filter(isManifest);
  if (manifests.length === 0) fail(`No latest*.yml in ${dir}; this is not a release folder.`);
  for (const manifest of manifests) {
    for (const { url, sha512 } of manifestEntries(await readFile(join(dir, manifest), "utf8"))) {
      const name = decodeURIComponent(url);
      if (!names.includes(name)) {
        console.error(`missing   ${name} (named by ${manifest})`);
        problems++;
        continue;
      }
      if ((await hash(join(dir, name), "sha512", "base64")) !== sha512) {
        console.error(`MISMATCH  ${name} (sha512 in ${manifest})`);
        problems++;
      } else checked++;
    }
  }

  if (problems > 0) fail(`${problems} problem(s) in ${dir}; do not mirror it.`);
  console.log(`Verified ${dir}: ${checked} check(s) passed.`);
  return names;
}

async function fetchRelease(tag, dir) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "faws-mirror" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const path = tag === "latest" ? "latest" : `tags/${tag.startsWith("v") ? tag : `v${tag}`}`;
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/${path}`, {
    headers,
  });
  if (!response.ok) fail(`GitHub answered ${response.status} for release ${tag}.`);
  const release = await response.json();

  await mkdir(dir, { recursive: true });
  const assets = release.assets.filter((asset) => !SKIP.has(asset.name));
  for (const asset of assets) {
    const target = join(dir, asset.name);
    if (existsSync(target)) {
      console.log(`have      ${asset.name}`);
      continue;
    }
    const download = await fetch(asset.browser_download_url, { headers: { "User-Agent": "faws-mirror" } });
    if (!download.ok || !download.body) fail(`Download of ${asset.name} failed: ${download.status}`);
    await pipeline(Readable.fromWeb(download.body), createWriteStream(`${target}.part`));
    await rename(`${target}.part`, target);
    console.log(`fetched   ${asset.name}`);
  }
  console.log(`${release.tag_name}: ${assets.length} file(s) in ${dir}`);
  await verify(dir);
}

function authorization() {
  if (process.env.MIRROR_AUTHORIZATION) return process.env.MIRROR_AUTHORIZATION;
  const user = process.env.MIRROR_USER;
  if (!user) return undefined;
  const password = process.env.MIRROR_PASSWORD ?? "";
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

async function push(dir, folderUrl) {
  let base;
  try {
    base = new URL(folderUrl.endsWith("/") ? folderUrl : `${folderUrl}/`);
  } catch {
    fail(`Not a URL: ${folderUrl}`);
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") fail("The folder URL must be http(s).");

  const names = await verify(dir);
  const ordered = [
    ...names.filter((name) => !isManifest(name)),
    ...names.filter(isManifest),
  ];
  const auth = authorization();
  for (const name of ordered) {
    const target = new URL(encodeURIComponent(name), base);
    const response = await fetch(target, {
      method: "PUT",
      headers: { ...(auth ? { Authorization: auth } : {}), "Content-Type": "application/octet-stream" },
      body: await openAsBlob(join(dir, name)),
    });
    if (!response.ok) {
      fail(
        `PUT ${target.href} answered ${response.status}. ` +
          (response.status === 400
            ? "On Nexus, the raw repository's deployment policy must allow redeploy."
            : ""),
      );
    }
    console.log(`uploaded  ${name}`);
  }
  console.log(`Mirrored into ${base.href}; point faws's Update source there.`);
}

const [command, first, second] = process.argv.slice(2);
if (command === "fetch" && first && second) await fetchRelease(first, second);
else if (command === "verify" && first) await verify(first);
else if (command === "push" && first && second) await push(first, second);
else {
  fail(
    [
      "Usage:",
      "  node scripts/mirror-release.mjs fetch <tag|latest> <dir>",
      "  node scripts/mirror-release.mjs verify <dir>",
      "  node scripts/mirror-release.mjs push <dir> <folder-url>",
    ].join("\n"),
  );
}
