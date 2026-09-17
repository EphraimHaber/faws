/**
 * Socket.IO event contracts, shared by `apps/server` and `apps/web`.
 *
 * Three namespaces:
 *   - default (`/`)      - server log fan-out and renderer navigation.
 *   - `/exec`            - interactive SSH / SSM / ECS Exec terminal streams.
 *   - `/s3-scan`         - recursive key walks, streamed and cancellable.
 */
import type {
  ExecHandshakeAuth,
  ExecPrompt,
  ExecPromptResponse,
  LogEvent,
  S3ObjectSummary,
  S3PrefixRollup,
  S3ScanProgress,
} from "@faws/contracts";

export interface ServerToClientEvents {
  "log:line": (payload: { json: string }) => void;
  /** Main process asking the renderer to navigate (menu accelerators). */
  nav: (payload: { target: string }) => void;
  /** Tail of a CloudWatch log group the renderer subscribed to. */
  "logs:event": (payload: { subscriptionId: string; events: ReadonlyArray<LogEvent> }) => void;
  "logs:error": (payload: { subscriptionId: string; message: string }) => void;
}

export interface ClientToServerEvents {
  "logs:subscribe": (payload: {
    subscriptionId: string;
    profile: string;
    region: string;
    logGroup: string;
    logStreamPrefix?: string;
  }) => void;
  "logs:unsubscribe": (payload: { subscriptionId: string }) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  readonly connectedAt: string;
}

/**
 * Handshake `auth` payload for a `/exec` connection.
 *
 * Defined in `@faws/contracts` because it is a zod schema first: the server
 * parses the handshake rather than trusting it, and the client builds one from
 * the same definition. Re-exported here so both sides can keep importing their
 * socket types from one place.
 */
export type { ExecHandshakeAuth } from "@faws/contracts";

export interface ExecServerToClientEvents {
  "exec:ready": (payload: { sessionId: string; resumed: boolean }) => void;
  /**
   * Terminal output, as bytes.
   *
   * Not a string: a PTY emits bytes, and a UTF-8 code point routinely splits
   * across two reads. Decoding each chunk server-side would cut those sequences
   * at arbitrary offsets and emit replacement characters - xterm's own
   * `write(Uint8Array)` carries the partial sequence across chunks instead.
   * Bytes also mean a stray `cat` of a binary, or a mouse report, survives.
   */
  "exec:data": (payload: { chunk: Uint8Array }) => void;
  "exec:exit": (payload: { code: number | null; reason: string | null }) => void;
  "exec:error": (payload: { code: string; userMessage: string }) => void;
  /**
   * Progress while connecting. SSH over an SSM tunnel takes several seconds,
   * and a blank terminal for that long reads as a hang.
   */
  "exec:status": (payload: { message: string }) => void;
  /** A decision only the person can make; the session waits for the answer. */
  "exec:prompt": (payload: ExecPrompt) => void;
  "exec:recording": (payload: { path: string | null }) => void;
}

export interface ExecClientToServerEvents {
  "exec:input": (payload: { chunk: Uint8Array }) => void;
  "exec:resize": (payload: { cols: number; rows: number }) => void;
  "exec:close": () => void;
  "exec:prompt:response": (payload: ExecPromptResponse) => void;
}

export interface ExecInterServerEvents {
  ping: () => void;
}

export interface ExecSocketData {
  /** Assigned by the namespace middleware once the handshake has parsed. */
  auth: ExecHandshakeAuth;
}

/**
 * Handshake `auth` for an `/s3-scan` connection.
 *
 * A scan belongs to its connection rather than to a message, so closing the
 * socket is one of the ways to cancel it: leaving the page cannot leave a walk
 * running against someone's bucket.
 */
export interface S3ScanHandshakeAuth {
  readonly scanId: string;
  readonly profile: string;
  readonly region: string;
  readonly bucket: string;
  readonly prefix: string;
  /** Absent walks every key, which is what a size rollup asks for. */
  readonly pattern?: string;
  readonly maxObjects: number;
  readonly maxSeconds: number;
}

export interface S3ScanServerToClientEvents {
  "s3scan:chunk": (payload: { objects: ReadonlyArray<S3ObjectSummary> }) => void;
  "s3scan:progress": (payload: S3ScanProgress) => void;
  "s3scan:done": (payload: { progress: S3ScanProgress; rollup: S3PrefixRollup }) => void;
  "s3scan:error": (payload: { code: string; userMessage: string }) => void;
}

export interface S3ScanClientToServerEvents {
  "s3scan:cancel": () => void;
}

export interface S3ScanInterServerEvents {
  ping: () => void;
}

export interface S3ScanSocketData {
  readonly auth: S3ScanHandshakeAuth;
}
