/**
 * faws-server - Fastify HTTP server exposing tRPC at /trpc and Socket.IO at /ws.
 *
 * Prints a port handshake on stdout for the desktop shell:
 *   faws-server-port: <port>
 *
 * Environment:
 *   FAWS_HOST      - bind host (default 127.0.0.1)
 *   FAWS_PORT      - bind port (default 0 = OS-assigned)
 *   FAWS_WEB_DIST  - when set, serve the web SPA from this directory at /
 *   FAWS_DATA_DIR  - where logs, recordings and settings are written
 *   FAWS_ALLOW_MUTATIONS - "1" starts the app with mutations allowed;
 *                          anything else leaves it read-only
 */
import * as fs from "node:fs";
import * as path from "node:path";

import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyReply } from "fastify";

import { attachExecNamespace } from "./api/exec/exec.service.ts";
import { registerExecDrivers } from "./api/exec/index.ts";
import { closeAllSessions } from "./api/exec/session.registry.ts";
import { storageBytesRoutes } from "./api/storage/bytes.routes.ts";
import { registerServerConnectionStores } from "./api/storage/connectionStore.ts";
import { attachStorageScanNamespace } from "./api/storage/scan.service.ts";
import { attachSettingsBroadcast } from "./api/settings/settings.events.ts";
import { flushSettings, loadSettings, settingsStore } from "./api/settings/settings.instance.ts";
import { applyTrust } from "./api/trust/trust.ts";
import { appRouter, type AppRouter } from "./router.ts";
import { createIndexHtmlRenderer } from "./shared/indexHtml.ts";
import { createLogger, getRootLogger } from "./shared/logger.ts";
import { setLoggerFactory } from "@faws/kit/server";
import { registerAwsObjectStorage } from "@faws/provider-aws/server";
import { registerS3compatObjectStorage } from "@faws/provider-s3compat/server";
import {
  closeSocketIO,
  getExecNamespace,
  getStorageScanNamespace,
  setupSocketIO,
} from "./shared/socket-io.ts";

// Provider packages log through kit; route them into the server's own log.
setLoggerFactory(createLogger);

const HOST = process.env["FAWS_HOST"] ?? "127.0.0.1";
const PORT = process.env["FAWS_PORT"] ? Number(process.env["FAWS_PORT"]) : 0;

// Cast to FastifyBaseLogger so Fastify's inferred Logger generic lines up with
// what the tRPC plugin expects - pino's BaseLogger carries `msgPrefix`, which
// FastifyBaseLogger doesn't declare.
const server = Fastify({
  loggerInstance: getRootLogger() as unknown as FastifyBaseLogger,
  routerOptions: { maxParamLength: 5000 },
  // Object bodies are streamed, and a stream that is still playing would hold
  // a shutdown open indefinitely; closing takes the sockets with it.
  forceCloseConnections: true,
});

server.addHook("onResponse", (request, reply, done) => {
  request.log.info(
    `${request.method} ${request.url} ${reply.statusCode} - ${reply.elapsedTime.toFixed(3)}ms`,
  );
  done();
});

server.setErrorHandler((error: FastifyError, request, reply) => {
  const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  request.log.error(
    { err: error, method: request.method, url: request.url, statusCode },
    `error handler: ${request.method} ${request.url} - ${error.message}`,
  );
  return reply.status(statusCode).send({
    error: statusCode >= 500 ? "Internal server error" : (error.name ?? "Error"),
    message: error.message,
  });
});

/**
 * Loopback only.
 *
 * `origin: true` reflects whatever asked, which was survivable while the API
 * could only read an inventory. It can now delete objects, so a page that
 * guesses this port is no longer harmless: the allowlist is what keeps the
 * answer to a drive by request a refusal.
 */
function isLocalOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  } catch {
    return false;
  }
}

await server.register(fastifyCors, {
  origin: (origin, callback) => {
    // A request with no origin is not a browser one, so there is nothing for
    // the policy to protect against.
    callback(null, origin === undefined || isLocalOrigin(origin));
  },
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  // `range` is what lets a viewer read a leading slice of a large object;
  // `content-range` has to be exposed for the script that asked to see it.
  allowedHeaders: ["content-type", "x-trpc-source", "x-method-override", "range"],
  exposedHeaders: ["content-range", "accept-ranges", "content-length", "etag"],
});

// Before listen, so the very first request already sees the stored values
// rather than defaults it would have to correct a moment later.
await loadSettings();
// Trust what the settings say before the first outbound connection, and again
// whenever they change (a reset, or another window removing a certificate).
{
  let lastTrust = settingsStore().get().settings.trust;
  applyTrust(lastTrust);
  settingsStore().subscribe((snapshot) => {
    if (snapshot.settings.trust === lastTrust) return;
    lastTrust = snapshot.settings.trust;
    applyTrust(lastTrust);
  });
}
// Saved S3 endpoints live in the settings file, so nothing may read one
// before it has been loaded.
registerServerConnectionStores();
// Each provider that stores objects answers the storage routes for its own
// connections.
registerAwsObjectStorage();
registerS3compatObjectStorage();

await server.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: {
    router: appRouter,
    allowMethodOverride: true,
    onError({ error, path }) {
      server.log.error({ err: error, path }, `[trpc] ${path ?? "<unknown>"}: ${error.message}`);
    },
  } satisfies FastifyTRPCPluginOptions<AppRouter>["trpcOptions"],
});

await server.register(storageBytesRoutes);

server.get("/healthz", () => ({ ok: true }));

const webDist = process.env["FAWS_WEB_DIST"];
if (webDist) {
  const root = path.resolve(webDist);
  if (fs.existsSync(path.join(root, "index.html"))) {
    // `index: false` so the shell always goes through the renderer below: a
    // statically served copy would reach the browser without the settings in
    // it, and the desktop app would be back to flashing on every launch.
    await server.register(fastifyStatic, { root, wildcard: false, index: false });
    const renderIndex = createIndexHtmlRenderer(root);
    const sendShell = async (reply: FastifyReply) =>
      reply.type("text/html").send(await renderIndex(settingsStore().get().settings));

    server.get("/", (_request, reply) => sendShell(reply));
    // Only the server's own namespaces answer 404. Everything else is a page
    // of the web app, so a reload or a deep link gets the shell; that is why
    // byte routes live under `/api/` rather than beside the pages they serve.
    server.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/trpc") || request.url.startsWith("/api/")) {
        return reply.status(404).send({ error: "Not Found", message: request.url });
      }
      return sendShell(reply);
    });
  } else {
    server.log.warn({ webDist: root }, "FAWS_WEB_DIST set but index.html not found");
  }
}

const address = await server.listen({ host: HOST, port: PORT });
const resolvedPort = (server.server.address() as { port: number } | null)?.port ?? PORT;

setupSocketIO(server);
attachSettingsBroadcast();
registerExecDrivers();
const execNs = getExecNamespace();
if (execNs) attachExecNamespace(execNs);
const scanNs = getStorageScanNamespace();
if (scanNs) attachStorageScanNamespace(scanNs);

console.log(`faws-server-port: ${resolvedPort}`);
console.log(`faws-server-url: ${address.replace(/\/$/, "")}/trpc`);

const shutdown = async () => {
  // Sessions first: a plugin child or an SSH connection must not outlive the
  // server that spawned it. Then sockets, which hold the HTTP server open - a
  // websocket never drains itself, so closing in the other order waits forever.
  // Settings first and fastest: a preference set a second ago is still only
  // in memory, and losing it is silent in a way a dropped session is not.
  await flushSettings();
  await closeAllSessions("the server is shutting down");
  await closeSocketIO();
  await server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
