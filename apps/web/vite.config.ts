import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const port = Number(process.env["PORT"] ?? 5741);
const host = process.env["HOST"]?.trim() || "localhost";
const configuredTrpcUrl = process.env["VITE_TRPC_URL"]?.trim();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  define: {
    "import.meta.env.VITE_TRPC_URL": JSON.stringify(configuredTrpcUrl ?? ""),
  },
  server: {
    host,
    port,
    strictPort: true,
    hmr: { protocol: "ws", host },
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: true },
});
