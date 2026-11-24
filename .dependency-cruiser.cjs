/**
 * Module boundaries for the workspace. ARCHITECTURE.md explains the layers
 * these rules keep apart; `pnpm check:deps` runs them.
 *
 * Every rule is an error: CI fails on a new violation. Rules naming
 * `packages/lib-*` describe packages that do not exist yet; they hold the
 * moment one does.
 */
/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "A cycle means two modules are one module; merge them or cut the edge. A cycle made only of type imports does not exist at runtime and is allowed.",
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ["type-only"] } },
    },
    {
      name: "packages-never-import-apps",
      severity: "error",
      comment: "Packages are compiled by the apps that use them, never the other way round.",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "contracts-stay-runtime-free",
      severity: "error",
      comment:
        "Contracts are zod and types, imported by every layer including the renderer. Provider manifests are plain data and the settings file is shaped by them, so those alone may be imported.",
      from: { path: "^packages/contracts/" },
      to: {
        path: "^packages/(core|lib-[^/]+|providers)/",
        pathNot: "^packages/providers/[^/]+/src/manifest\\.ts$",
      },
    },
    {
      name: "kit-never-imports-providers",
      severity: "error",
      comment: "The provider SDK defines the contract; providers implement it.",
      from: { path: "^packages/kit/" },
      to: { path: "^packages/providers/" },
    },
    {
      name: "providers-stay-independent",
      severity: "error",
      comment: "One provider never reaches into another; shared code belongs in kit or a lib-*.",
      from: { path: "^packages/providers/([^/]+)/" },
      to: { path: "^packages/providers/", pathNot: "^packages/providers/$1/" },
    },
    {
      name: "web-never-imports-server-code",
      severity: "error",
      comment: "The renderer may only see server types (the tRPC router), never server code.",
      from: { path: "^(apps/web/|packages/[^/]+/src/web/|packages/providers/[^/]+/src/web/)" },
      to: {
        path: "^(apps/server/|packages/(core|lib-[^/]+)/|packages/providers/[^/]+/src/server/)",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "no-orphans",
      severity: "info",
      comment: "A module nothing imports is dead code or a missing entry point.",
      from: {
        orphan: true,
        pathNot: [
          "\\.d\\.ts$",
          "\\.(test|spec)\\.tsx?$",
          "(^|/)(vite|vitest|tsdown)\\.config\\.ts$",
          "^scripts/",
          "/main\\.tsx?$",
          "/preload\\.ts$",
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(node_modules|dist|dist-electron|\\.turbo)/" },
    // TypeScript 7 has no JS compiler API for dependency-cruiser to call, so
    // sources are parsed with swc; type-only imports are still told apart.
    parser: "swc",
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    // apps/web is the only tsconfig with path aliases (`~/*`); the others resolve
    // through package exports, which enhancedResolveOptions handles.
    tsConfig: { fileName: "apps/web/tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["types", "import", "default"],
      extensions: [".ts", ".tsx", ".js", ".mjs"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
