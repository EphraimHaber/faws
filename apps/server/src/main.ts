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
 *   FAWS_DATA_DIR  - where logs are written
 *   FAWS_READ_ONLY - "1" starts the app with mutations blocked
 */
import * as fs from "node:fs";
import * as path from "node:path";

import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyBaseLogger, type FastifyError } from "fastify";

import { attachExecNamespace } from "./api/exec/exec.service.ts";
import { registerExecDrivers } from "./api/exec/index.ts";
import { s3BytesRoutes } from "./api/s3/bytes.routes.ts";
import { attachS3ScanNamespace } from "./api/s3/scan.service.ts";
import { appRouter, type AppRouter } from "./router.ts";
import { getRootLogger } from "./shared/logger.ts";
import {
  closeSocketIO,
  getExecNamespace,
  getS3ScanNamespace,
  setupSocketIO,
} from "./shared/socket-io.ts";

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

await server.register(s3BytesRoutes);

server.get("/healthz", () => ({ ok: true }));

const webDist = process.env["FAWS_WEB_DIST"];
if (webDist) {
  const root = path.resolve(webDist);
  if (fs.existsSync(path.join(root, "index.html"))) {
    await server.register(fastifyStatic, { root, wildcard: false });
    server.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/trpc") || request.url.startsWith("/s3/")) {
        return reply.status(404).send({ error: "Not Found", message: request.url });
      }
      return reply.type("text/html").sendFile("index.html");
    });
  } else {
    server.log.warn({ webDist: root }, "FAWS_WEB_DIST set but index.html not found");
  }
}

const address = await server.listen({ host: HOST, port: PORT });
const resolvedPort = (server.server.address() as { port: number } | null)?.port ?? PORT;

setupSocketIO(server);
registerExecDrivers();
const execNs = getExecNamespace();
if (execNs) attachExecNamespace(execNs);
const scanNs = getS3ScanNamespace();
if (scanNs) attachS3ScanNamespace(scanNs);

console.log(`faws-server-port: ${resolvedPort}`);
console.log(`faws-server-url: ${address.replace(/\/$/, "")}/trpc`);

const shutdown = async () => {
  // Sockets first: they hold the HTTP server open, so closing in the other
  // order waits forever on a connection that will never drain itself.
  await closeSocketIO();
  await server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
