/**
 * The object byte transport.
 *
 * Bytes do not travel over tRPC: superjson would base64 them and hold the
 * whole object in memory on the way through. They are piped from S3 to the
 * reply instead, which also means a range request stays a range request, so
 * the media elements seek and a viewer can read a leading slice of something
 * far too large to open.
 *
 * Nothing signed ever reaches the renderer. The alternative, a presigned URL,
 * is a bearer grant of the caller's own IAM rights sitting in a DOM attribute,
 * and it would need the customer's bucket to allow this origin in its CORS
 * policy before a browser would fetch it at all.
 */
import { pipeline } from "node:stream/promises";

import { getObjectStream } from "@faws/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { toTrpcError } from "../../trpc/index.ts";

const objectQuery = z.object({
  profile: z.string(),
  region: z.string().min(1),
  bucket: z.string().min(1),
  key: z.string().min(1),
  versionId: z.string().optional(),
  disposition: z.enum(["inline", "attachment"]).default("attachment"),
  /** Suppresses the stored encoding so a viewer can see the bytes as stored. */
  raw: z.enum(["0", "1"]).default("0"),
});

/**
 * Types that may render in the page.
 *
 * This route is same origin with the API that holds the caller's credentials,
 * so an object someone else wrote could otherwise be served as a document and
 * run as script here. Anything not on this list is downloaded as an opaque
 * stream instead, whatever it claims to be.
 */
const INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "application/pdf",
  "text/plain",
]);

const INLINE_PREFIXES = ["audio/", "video/"];

function inlineType(contentType: string | null): string | null {
  if (!contentType) return null;
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (INLINE_TYPES.has(type)) return type;
  if (INLINE_PREFIXES.some((prefix) => type.startsWith(prefix))) return type;
  return null;
}

/** The last segment of the key, for the name a download lands under. */
function downloadName(key: string): string {
  const name = key.slice(key.lastIndexOf("/") + 1) || "object";
  // Quotes and control characters would break out of the header's own syntax.
  return name.replaceAll(/["\\\r\n]/g, "_");
}

export async function s3BytesRoutes(server: FastifyInstance): Promise<void> {
  server.get("/s3/object", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = objectQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "BadRequest", message: parsed.error.message });
    }
    const query = parsed.data;

    // An abandoned tab should stop the read rather than pay for all of it.
    const controller = new AbortController();
    request.raw.on("close", () => controller.abort());

    const range = request.headers.range;

    let stream;
    try {
      stream = await getObjectStream(
        { profile: query.profile, region: query.region },
        {
          bucket: query.bucket,
          key: query.key,
          ...(query.versionId ? { versionId: query.versionId } : {}),
        },
        { ...(range ? { range } : {}), signal: controller.signal },
      );
    } catch (err) {
      const mapped = toTrpcError(err);
      const status = mapped.code === "NOT_FOUND" ? 404 : 400;
      return reply.status(status).send({ error: mapped.code, message: mapped.message });
    }

    const allowed = query.disposition === "inline" ? inlineType(stream.contentType) : null;
    const disposition = allowed ? "inline" : "attachment";

    const headers: Record<string, string | number | string[]> = {
      // Whatever the plugins put on the reply, the cross origin headers in
      // particular: hijacking means nothing else will send them.
      ...(reply.getHeaders() as Record<string, string | number | string[]>),
      "content-type": allowed ?? "application/octet-stream",
      "content-disposition": `${disposition}; filename="${downloadName(query.key)}"`,
      // Sniffing is what would turn an opaque stream back into a document.
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
      "accept-ranges": "bytes",
    };
    if (stream.etag) headers["etag"] = `"${stream.etag}"`;
    if (stream.contentLength !== null) headers["content-length"] = stream.contentLength;
    // `raw` leaves the encoding off, so the browser hands over what is stored
    // rather than inflating it; the hex viewer is the reason.
    if (stream.contentEncoding && query.raw === "0") {
      headers["content-encoding"] = stream.contentEncoding;
    }
    if (stream.contentRange) headers["content-range"] = stream.contentRange;

    // Hijacking hands the socket over, so the headers Fastify was holding are
    // never sent: they have to be written here, before the first byte.
    reply.hijack();
    reply.raw.writeHead(stream.contentRange ? 206 : 200, headers);
    try {
      await pipeline(stream.body, reply.raw);
    } catch (err) {
      // The common case is the client leaving mid stream, which is not a fault
      // worth logging as one.
      if (!controller.signal.aborted) {
        request.log.warn({ err, bucket: query.bucket, key: query.key }, "object stream failed");
      }
      reply.raw.destroy();
    }
  });
}
