import { resolveServerOrigin } from "./apiUrl.ts";
import { trpcClient } from "./trpc.ts";

/** Bytes per part. Ten thousand of these reaches 160 GB, which is enough. */
const PART_SIZE = 16 * 1024 * 1024;

/** Parts in flight at once; more saturates a home connection for no gain. */
const CONCURRENCY = 4;

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
      await sendPart(input.uploadToken, null, input.file, requests, (sent) =>
        input.onProgress({ sent, total }),
      );
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
        const etag = await sendPart(input.uploadToken, partNumber, blob, requests, (sent) => {
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

/**
 * One part.
 *
 * `XMLHttpRequest` rather than `fetch`, which still cannot report how much of
 * a request body has been sent - the one number a progress bar needs.
 */
function sendPart(
  uploadToken: string,
  partNumber: number | null,
  blob: Blob,
  requests: Set<XMLHttpRequest>,
  onProgress: (sent: number) => void,
): Promise<string> {
  const url = new URL("/s3/upload", resolveServerOrigin());
  url.searchParams.set("uploadToken", uploadToken);
  if (partNumber !== null) url.searchParams.set("partNumber", String(partNumber));

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    requests.add(request);
    request.open("POST", url.toString());
    request.setRequestHeader("content-type", "application/octet-stream");
    request.upload.addEventListener("progress", (event) => onProgress(event.loaded));

    request.addEventListener("load", () => {
      requests.delete(request);
      if (request.status >= 200 && request.status < 300) {
        const body = parseBody(request.responseText);
        resolve(body.etag ?? "");
        return;
      }
      reject(new Error(parseBody(request.responseText).message ?? `${request.status}`));
    });
    request.addEventListener("error", () => {
      requests.delete(request);
      reject(new Error("The upload connection failed."));
    });
    request.addEventListener("abort", () => {
      requests.delete(request);
      reject(new Error("Upload cancelled."));
    });

    request.send(blob);
  });
}

function parseBody(text: string): { etag?: string; message?: string } {
  try {
    return JSON.parse(text || "{}") as { etag?: string; message?: string };
  } catch {
    // A body that is not JSON did not come from the route's own error path.
    return {};
  }
}
