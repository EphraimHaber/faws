import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const port = Number(process.env["PORT"] ?? 5741);
const host = process.env["HOST"]?.trim() || "localhost";
const configuredTrpcUrl = process.env["VITE_TRPC_URL"]?.trim();
// The app's version is the desktop package's: it is what is released, and the
// browser build shows the same number so "What's new" can mark it.
const appVersion = (
  JSON.parse(readFileSync(new URL("../desktop/package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  define: {
    "import.meta.env.VITE_TRPC_URL": JSON.stringify(configuredTrpcUrl ?? ""),
    "import.meta.env.APP_VERSION": JSON.stringify(appVersion),
  },
  server: {
    host,
    port,
    strictPort: true,
    hmr: { protocol: "ws", host },
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: true },
});
