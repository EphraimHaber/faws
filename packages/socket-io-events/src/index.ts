/**
 * Socket.IO event contracts, shared by `apps/server` and `apps/web`.
 *
 * Two namespaces:
 *   - default (`/`)      - server log fan-out and renderer navigation.
 *   - `/exec`            - interactive ECS Exec / SSM terminal streams.
 */
import type { LogEvent } from "@faws/contracts";

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
