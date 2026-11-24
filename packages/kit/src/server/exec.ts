/**
 * The contract between the terminal host and whatever opens a shell.
 *
 * The host owns sockets, recording, prompts and the session list; a driver
 * owns one kind of connection (ECS exec, SSM, SSH, a pod). Providers
 * contribute drivers through `TerminalContribution`, so a provider that is
 * switched off simply contributes none.
 *
 * Generic over the handshake and prompt shapes so this package needs no
 * contract types; the host and the providers fill them in from contracts.
 */
import type { Duplex } from "node:stream";

import type { Logger } from "./log.ts";

export interface ExecDriver {
  write(chunk: Uint8Array): void;
  resize(cols: number, rows: number): void;
  /** Idempotent: every teardown path funnels here, and several can race. */
  close(reason: string): void | Promise<void>;
}

/** What a driver can send back without knowing a socket exists. */
export interface ExecSink {
  data(chunk: Uint8Array): void;
  exit(code: number | null, reason: string | null): void;
  error(code: string, userMessage: string): void;
  /** One line of connect progress, for the several-second paths. */
  status(message: string): void;
}

export interface ExecContext<Prompt = unknown, PromptResponse = unknown> {
  readonly log: Logger;
  /**
   * Asks the person something and waits. Rejects if they cancel, if the tab
   * goes away, or on timeout - all three are refusals, never consent.
   */
  ask(prompt: Prompt): Promise<PromptResponse>;
  /**
   * Aborts when the client disconnects, so a slow connect actually cancels its
   * calls instead of finishing into a socket nobody is holding.
   */
  readonly signal: AbortSignal;
}

/**
 * Async because every driver awaits before its first byte - ExecuteCommand,
 * StartSession, an SSH handshake. A synchronous factory would force each one to
 * fire-and-forget its setup and hand-roll a buffer for input that arrives
 * before the connection is up.
 */
export type ExecDriverFactory<Auth = unknown, Prompt = unknown, PromptResponse = unknown> = (
  auth: Auth,
  sink: ExecSink,
  ctx: ExecContext<Prompt, PromptResponse>,
) => Promise<ExecDriver>;

/** One kind of shell a provider can open. */
export interface TerminalContribution<Kind extends string = string, Auth = unknown> {
  readonly kind: Kind;
  readonly factory: ExecDriverFactory<Auth, any, any>;
}

/**
 * The last hop of an SSH connection, reached some way other than dialling it.
 *
 * SSH itself belongs to the host: the handshake, host keys, jump chains and
 * the shell channel. Getting a byte stream to the far sshd, or the key it will
 * accept, can belong to a provider - an SSM tunnel, an EC2 Instance Connect key
 * pushed for this session only. A provider contributes that part as an
 * `SshRouteContribution`, and the host's SSH driver finishes the connection.
 */
export interface SshRoute {
  /** The name the handshake dials or resolves through ~/.ssh/config, and verifies the host key for. */
  readonly target: string;
  readonly port: number;
  readonly user: string | undefined;
  /** A stream already connected to the far sshd; absent means dial `target`. */
  readonly sock?: Duplex;
  /** A key to offer before anything on disk, good for this handshake only. */
  readonly privateKey?: Buffer;
  /** Zeroes `privateKey`. The host calls it once the handshake is done with it, or failed. */
  scrub?(): void;
  /** Tears down whatever carries `sock`, after the SSH client has closed. */
  close?(): Promise<void>;
}

export interface SshRouteContext {
  readonly log: Logger;
  /** One line of connect progress. */
  status(message: string): void;
  readonly signal: AbortSignal;
}

/** One way of reaching an SSH host, keyed by the handshake's `transport.via`. */
export interface SshRouteContribution<Via extends string = string, Transport = unknown> {
  readonly via: Via;
  open(
    transport: Transport,
    requested: { readonly user: string | undefined; readonly port: number | undefined },
    ctx: SshRouteContext,
  ): Promise<SshRoute>;
}

/**
 * The error every layer of the exec stack throws.
 *
 * The `code` is the whole point: it is what the UI switches on to offer the
 * right next step, so an error that reaches the client as "Internal" has lost
 * the only part of itself that was useful.
 */
export class ExecSessionError<Code extends string = string> extends Error {
  readonly code: Code;

  constructor(code: Code, message: string) {
    super(message);
    this.name = "ExecSessionError";
    this.code = code;
  }
}

/** True for an error that already carries a code worth showing. */
export function isExecSessionError(err: unknown): err is ExecSessionError {
  return err instanceof ExecSessionError;
}
