/**
 * Socket.IO event contracts, shared by `apps/server` and `apps/web`.
 *
 * Three namespaces:
 *   - default (`/`)      - server log fan-out and renderer navigation.
 *   - `/exec`            - interactive ECS Exec / SSM terminal streams.
 *   - `/s3-scan`         - recursive key walks, streamed and cancellable.
 */
import type { LogEvent, S3ObjectSummary, S3PrefixRollup, S3ScanProgress } from "@faws/contracts";

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

/** Handshake `auth` payload for a `/exec` connection. */
export interface ExecHandshakeAuth {
  readonly sessionId: string;
  readonly profile: string;
  readonly region: string;
  readonly cluster: string;
  readonly taskId: string;
  readonly containerName: string;
  readonly shell: string;
  readonly cols: number;
  readonly rows: number;
}

export interface ExecServerToClientEvents {
  "exec:ready": (payload: { sessionId: string }) => void;
  "exec:data": (payload: { chunk: string }) => void;
  "exec:exit": (payload: { code: number | null; reason: string | null }) => void;
  "exec:error": (payload: { code: string; userMessage: string }) => void;
}

export interface ExecClientToServerEvents {
  "exec:input": (payload: { chunk: string }) => void;
  "exec:resize": (payload: { cols: number; rows: number }) => void;
  "exec:close": () => void;
}

export interface ExecInterServerEvents {
  ping: () => void;
}

export interface ExecSocketData {
  readonly auth: ExecHandshakeAuth;
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
