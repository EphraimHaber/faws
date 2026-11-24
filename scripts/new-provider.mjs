/**
 * Scaffolds a provider package the way the existing ones are built.
 *
 *   pnpm new:provider <id> "<Label>"
 *
 * Writes packages/providers/<id> with a manifest, a gated router and a test,
 * then lists the four places that register a provider. Each of those is typed
 * against the list of provider ids, so until they are all done the build says
 * which one is missing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [id, label] = process.argv.slice(2);
if (!id || !/^[a-z][a-z0-9-]*$/.test(id) || !label) {
  console.error('Usage: pnpm new:provider <id> "<Label>"   (id: lowercase, e.g. "proxmox")');
  process.exit(1);
}

const root = join(import.meta.dirname, "..");
const dir = join(root, "packages", "providers", id);
if (existsSync(dir)) {
  console.error(`packages/providers/${id} already exists.`);
  process.exit(1);
}

const camel = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const kitVersion = JSON.parse(readFileSync(join(root, "packages/kit/package.json"), "utf8"));

const files = {
  "package.json": `${JSON.stringify(
    {
      name: `@faws/provider-${id}`,
      version: kitVersion.version,
      private: true,
      type: "module",
      exports: {
        "./manifest": { types: "./src/manifest.ts", default: "./src/manifest.ts" },
        "./server": { types: "./src/server/index.ts", default: "./src/server/index.ts" },
      },
      scripts: { typecheck: "tsc --noEmit", test: "vitest run --passWithNoTests" },
      dependencies: {
        "@faws/contracts": "workspace:*",
        "@faws/kit": "workspace:*",
        [`@faws/provider-${id}-manifest`]: "workspace:*",
        "@trpc/server": "catalog:trpc",
        zod: "catalog:",
      },
      devDependencies: {
        "@types/node": "catalog:build",
        typescript: "catalog:build",
        vitest: "catalog:build",
      },
    },
    null,
    2,
  )}\n`,
  "tsconfig.json": `{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src/**/*.ts"]
}
`,
  "manifest/package.json": `${JSON.stringify(
    {
      name: `@faws/provider-${id}-manifest`,
      version: kitVersion.version,
      private: true,
      type: "module",
      exports: { ".": { types: "./src/index.ts", default: "./src/index.ts" } },
      scripts: { typecheck: "tsc --noEmit" },
      dependencies: { "@faws/kit": "workspace:*" },
      devDependencies: { "@types/node": "catalog:build", typescript: "catalog:build" },
    },
    null,
    2,
  )}\n`,
  "manifest/tsconfig.json": `{
  "extends": "../../../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src/**/*.ts"]
}
`,
  "src/manifest.ts": `export * from "@faws/provider-${id}-manifest";
`,
  "manifest/src/index.ts": `import { defineProvider } from "@faws/kit";

/** ${label}: what it is, and how faws reaches it. */
export const ${camel}Manifest = defineProvider({
  id: "${id}",
  label: "${label}",
  description: "TODO: one line on what ${label} gives you",
  icon: "server",
  order: 100,
  defaultEnabled: false,
  capabilities: [],
  runtimeDefaults: {},
  services: [
    {
      id: "${id}",
      label: "${label}",
      description: "TODO",
      icon: "server",
      status: "planned",
      basePath: "/${id}",
      sections: [],
    },
  ],
});
`,
  "src/server/index.ts": `/** ${label} on the server. */
import { defineProviderServer } from "@faws/kit/server";

import { ${camel}Manifest } from "../manifest.ts";
import { ${camel}Router } from "./${id}.router.ts";

/** Mounted by the host under the manifest id, so the client path is \`trpc["${id}"]\`. */
export const ${camel}Server = defineProviderServer({
  id: ${camel}Manifest.id,
  router: ${camel}Router,
});
`,
  [`src/server/${id}.router.ts`]: `import { providerProcedure, router } from "@faws/kit/server";

/** Every procedure here answers only while ${label} is switched on. */
const ${camel}Procedure = providerProcedure("${id}");

export const ${camel}Router = router({
  ping: ${camel}Procedure.query(() => "pong" as const),
});
`,
  [`src/server/${id}.router.test.ts`]: `import { describe, expect, it } from "vitest";

import { ${camel}Router } from "./${id}.router.ts";

describe("${camel}Router", () => {
  it("answers", async () => {
    await expect(${camel}Router.createCaller({}).ping()).resolves.toBe("pong");
  });
});
`,
};

for (const [file, content] of Object.entries(files)) {
  mkdirSync(join(dir, file, ".."), { recursive: true });
  writeFileSync(join(dir, file), content);
}

console.log(`Created packages/providers/${id}. Now register it:

  1. packages/contracts/src/providers.ts: add ${camel}Manifest (from
     "@faws/provider-${id}-manifest") to PROVIDER_MANIFESTS, and that package to
     contracts' dependencies. The manifest is its own package so contracts
     never depends on provider code, which would be a package cycle.
  2. packages/contracts/src/settings.ts: give it a section in providerSections and
     providersPatchSchema; both are typed against every provider id, so the
     build fails until it has one.
  3. apps/server/src/router.ts: add ${camel}Server to mountProviders([...])
     (and add the package to apps/server's dependencies).
  4. apps/web/src/features/overview/ProviderHealth.tsx: give it a tile (the
     web nav reads PROVIDER_MANIFESTS from contracts).

Then: pnpm install && pnpm typecheck && pnpm test`);
