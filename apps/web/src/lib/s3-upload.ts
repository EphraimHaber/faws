import { resolveServerOrigin } from "./apiUrl.ts";
import { trpcClient } from "./trpc.ts";

/** Bytes per part. Ten thousand of these reaches 160 GB, which is enough. */
const PART_SIZE = 16 * 1024 * 1024;

/** Parts in flight at once; more saturates a home connection for no gain. */
const CONCURRENCY = 4;

/**
 * Where a part is sent.
 *
 * Either this app's own server, which holds the credentials and forwards the
 * bytes, or S3 itself with a signature the server minted. The two differ in
 * the method and in what comes back: the proxy answers with the part's etag in
 * a JSON body, while S3 returns it as a header.
 */
type Target =
  | { kind: "proxy"; url: string }
  | { kind: "signed"; url: string; contentType: string; ifNoneMatch: boolean };

export type UploadTransport = "proxy" | "presigned";

export interface UploadProgress {
  readonly sent: number;
  readonly total: number;
}

export interface UploadHandle {
  readonly promise: Promise<void>;
  cancel(): void;
}

/**
 * Sends a file, in parts when it is large enough to need them.
 *
 * Progress is measured here rather than reported by the server, because the
 * slow leg is the one out of this browser: the server could only say how much
 * it had already received, which is the wrong number one round trip late.
 *
 * Per part requests also buy what a single streamed body cannot: one failed
 * part can be the only thing retried, and cancelling is an abort rather than a
 * connection left to drain.
 */
export function uploadFile(input: {
  file: File;
  uploadToken: string;
  multipart: boolean;
  transport: UploadTransport;
  /** The signed destination of a single request presigned upload. */
  url?: string | null;
  /** True when the signature carries the refuse-if-it-exists condition. */
  overwrite?: boolean;
  onProgress: (progress: UploadProgress) => void;
}): UploadHandle {
  const requests = new Set<XMLHttpRequest>();
  let cancelled = false;

  const cancel = () => {
    cancelled = true;
    for (const request of requests) request.abort();
  };

  const promise = (async () => {
    const total = input.file.size;

    if (!input.multipart) {
      const target: Target =
        input.transport === "presigned"
          ? {
              kind: "signed",
              url: required(input.url),
              contentType: input.file.type,
              ifNoneMatch: input.overwrite !== true,
            }
          : { kind: "proxy", url: proxyUrl(input.uploadToken, null) };

      await send(target, input.file, requests, (sent) => input.onProgress({ sent, total }));

      // A presigned single upload never reaches the server, so the session it
      // was opened with is closed here rather than by the route.
      if (input.transport === "presigned") {
        await trpcClient.s3Actions.abortUpload.mutate({ uploadToken: input.uploadToken });
      }
      return;
    }

    const partCount = Math.max(1, Math.ceil(total / PART_SIZE));
    const parts: Array<{ partNumber: number; etag: string }> = [];

    // Progress is what has landed plus what is in flight, so the bar moves
    // during a part rather than jumping between them.
    const inFlight = new Map<number, number>();
    let settled = 0;
    const report = () => {
      const pending = [...inFlight.values()].reduce((sum, value) => sum + value, 0);
      input.onProgress({ sent: Math.min(total, settled + pending), total });
    };

    let next = 1;
    const worker = async () => {
      // `cancelled` is set by `cancel()` while this is awaiting a part, which
      // is exactly the point: the loop stops between parts.
      // oxlint-disable-next-line eslint/no-unmodified-loop-condition
      while (!cancelled) {
        const partNumber = next;
        next += 1;
        if (partNumber > partCount) return;

        const start = (partNumber - 1) * PART_SIZE;
        const blob = input.file.slice(start, Math.min(start + PART_SIZE, total));

        // Signed one part at a time: a signature minted at the start of a long
        // upload has expired by the time the last parts go out.
        const target: Target =
          input.transport === "presigned"
            ? {
                kind: "signed",
                url: (
                  await trpcClient.s3Actions.presignPart.mutate({
                    uploadToken: input.uploadToken,
                    partNumber,
                  })
                ).url,
                contentType: "",
                // A part carries no condition; the completion does.
                ifNoneMatch: false,
              }
            : { kind: "proxy", url: proxyUrl(input.uploadToken, partNumber) };

        const etag = await send(target, blob, requests, (sent) => {
          inFlight.set(partNumber, sent);
          report();
        });
        inFlight.delete(partNumber);
        settled += blob.size;
        report();
        parts.push({ partNumber, etag });
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, partCount) }, worker));
    if (cancelled) throw new Error("Upload cancelled.");

    await trpcClient.s3Actions.completeUpload.mutate({ uploadToken: input.uploadToken, parts });
  })();

  return { promise, cancel };
}

function proxyUrl(uploadToken: string, partNumber: number | null): string {
  const url = new URL("/s3/upload", resolveServerOrigin());
  url.searchParams.set("uploadToken", uploadToken);
  if (partNumber !== null) url.searchParams.set("partNumber", String(partNumber));
  return url.toString();
}

function required(url: string | null | undefined): string {
  if (!url) throw new Error("The server did not return a signed URL for this upload.");
  return url;
}

/**
 * One part, over `XMLHttpRequest`.
 *
 * `fetch` still cannot report how much of a request body has been sent, which
 * is the one number a progress bar needs.
 */
function send(
  target: Target,
  blob: Blob,
  requests: Set<XMLHttpRequest>,
  onProgress: (sent: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    requests.add(request);
    // S3 takes a PUT at a signed URL; the proxy route takes a POST, which is
    // what keeps the app's own allowed method list as narrow as it is.
    request.open(target.kind === "signed" ? "PUT" : "POST", target.url);

    if (target.kind === "proxy") {
      request.setRequestHeader("content-type", "application/octet-stream");
    } else {
      if (target.contentType) {
        // Signed into the URL, so it has to match what was signed for.
        request.setRequestHeader("content-type", target.contentType);
      }
      if (target.ifNoneMatch) {
        // Part of the signature rather than an extra: the refusal to overwrite
        // is in the URL, and S3 rejects the request outright without it.
        request.setRequestHeader("if-none-match", "*");
      }
    }

    request.upload.addEventListener("progress", (event) => onProgress(event.loaded));

    request.addEventListener("load", () => {
      requests.delete(request);
      if (request.status >= 200 && request.status < 300) {
        resolve(
          target.kind === "signed"
            ? // S3 answers with the etag as a header; the browser can read it
              // because it is one of the few headers exposed by default.
              (request.getResponseHeader("etag") ?? "").replaceAll('"', "")
            : (parseBody(request.responseText).etag ?? ""),
        );
        return;
      }
      reject(new Error(failureMessage(target, request)));
    });
    request.addEventListener("error", () => {
      requests.delete(request);
      reject(
        new Error(
          target.kind === "signed"
            ? "The browser could not reach S3 directly. The bucket's CORS policy has to allow this origin for presigned uploads."
            : "The upload connection failed.",
        ),
      );
    });
    request.addEventListener("abort", () => {
      requests.delete(request);
      reject(new Error("Upload cancelled."));
    });

    request.send(blob);
  });
}

function failureMessage(target: Target, request: XMLHttpRequest): string {
  if (target.kind === "proxy") {
    return parseBody(request.responseText).message ?? `${request.status}`;
  }
  // S3 answers with an XML document rather than JSON.
  const code = /<Code>([^<]+)<\/Code>/.exec(request.responseText)?.[1];
  const message = /<Message>([^<]+)<\/Message>/.exec(request.responseText)?.[1];
  return message
    ? `${code ?? request.status}: ${message}`
    : `S3 refused the part (${request.status}).`;
}

function parseBody(text: string): { etag?: string; message?: string } {
  try {
    return JSON.parse(text || "{}") as { etag?: string; message?: string };
  } catch {
    // A body that is not JSON did not come from the route's own error path.
    return {};
  }
}
