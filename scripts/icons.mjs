#!/usr/bin/env node
// Renders the faws icon set from the SVG masters in apps/desktop/build.
// macOS only: rasterising goes through `sips` and the .icns through `iconutil`,
// so the script needs no npm dependencies.
//
//   node scripts/icons.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const build = join(root, "apps/desktop/build");
const master = join(build, "icon.svg");
// the full radar turns to mush below 48px, so small sizes use a bolder cut
const small = join(build, "icon-small.svg");
const tray = join(build, "tray.svg");
const SMALL_MAX = 32;

if (process.platform !== "darwin") {
  console.error("icons.mjs needs macOS (sips and iconutil).");
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), "faws-icons-"));

function render(svg, size, out) {
  execFileSync("sips", ["-s", "format", "png", "-z", String(size), String(size), svg, "--out", out], {
    stdio: "ignore",
  });
  return out;
}

const sourceFor = (size) => (size <= SMALL_MAX ? small : master);

try {
  render(master, 1024, join(build, "icon.png"));

  const linux = join(build, "icons");
  mkdirSync(linux, { recursive: true });
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
    render(sourceFor(size), size, join(linux, `${size}x${size}.png`));
  }

  const iconset = join(scratch, "icon.iconset");
  mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    render(sourceFor(size), size, join(iconset, `icon_${size}x${size}.png`));
    render(sourceFor(size * 2), size * 2, join(iconset, `icon_${size}x${size}@2x.png`));
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(build, "icon.icns")]);

  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoImages = icoSizes.map((size) =>
    readFileSync(render(sourceFor(size), size, join(scratch, `ico-${size}.png`))),
  );
  writeFileSync(join(build, "icon.ico"), packIco(icoSizes, icoImages));

  // sips cannot resolve currentColor, and template images only use the alpha channel
  const traySvg = join(scratch, "tray.svg");
  writeFileSync(traySvg, readFileSync(tray, "utf8").replaceAll("currentColor", "#000000"));
  render(traySvg, 16, join(build, "trayTemplate.png"));
  render(traySvg, 32, join(build, "trayTemplate@2x.png"));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`icons written to ${build}`);

// ico container holding png payloads, which every windows since vista reads
function packIco(sizes, pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);

  const entries = Buffer.alloc(16 * pngs.length);
  let offset = header.length + entries.length;
  pngs.forEach((png, i) => {
    const at = i * 16;
    // a dimension byte of 0 means 256
    entries.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], at);
    entries.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], at + 1);
    entries.writeUInt8(0, at + 2);
    entries.writeUInt8(0, at + 3);
    entries.writeUInt16LE(1, at + 4);
    entries.writeUInt16LE(32, at + 6);
    entries.writeUInt32LE(png.length, at + 8);
    entries.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });

  return Buffer.concat([header, entries, ...pngs]);
}
