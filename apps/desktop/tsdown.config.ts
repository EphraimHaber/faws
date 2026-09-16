import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/main.ts"],
    format: ["cjs"],
    outDir: "dist-electron",
    outExtensions: () => ({ js: ".cjs" }),
    platform: "node",
    target: "node22",
    external: ["electron"],
    clean: true,
  },
  {
    entry: ["src/preload.ts"],
    format: ["cjs"],
    outDir: "dist-electron",
    outExtensions: () => ({ js: ".cjs" }),
    platform: "node",
    target: "node22",
    external: ["electron"],
  },
]);
