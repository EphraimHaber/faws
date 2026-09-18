/**
 * Every live session, and the only thing that owns one.
 *
 * The split that makes this work: a driver produces bytes and knows nothing
 * about sockets, while the registry owns the socket, the replay buffer, the
 * state machine and the prompt broker. That is what lets a tab's socket drop
 * and come back without any driver containing a line of reconnect logic, and it
 * is why `ExecSink` exists rather than handing drivers the socket directly.
 *
 * Sessions are keyed by the client-generated `sessionId`, which outlives the
 * socket that created it - that key is the whole basis of reattach.
 */
import type { ExecHandshakeAuth, ExecPrompt, ExecPromptResponse } from "@faws/contracts";

import { createLogger } from "../../shared/logger.ts";
import type { ExecDriver, ExecDriverFactory, ExecSink } from "./exec.service.ts";
import { ExecSessionError } from "./errors.ts";
import { PromptBroker } from "./prompts.ts";
import { startRecording, type Recorder } from "./recorder.ts";
import { OutputRingBuffer } from "./ringBuffer.ts";
import { DEFAULT_TIMERS, SessionMachine, type SessionTimers } from "./session.state.ts";

const log = createLogger("exec");

/**
 * Bounds, all overridable by env because the right value depends on the
 * machine rather than on us.
 *
 * The concurrency caps are not a policy about how many terminals a person
 * should want - they are a guard against a bug. A reconnect loop that spawns a
 * session per attempt should hit a wall rather than fork-bomb the machine with
 * plugin children.
 */
const MAX_CONCURRENT = envInt("FAWS_EXEC_MAX_SESSIONS", 8);
const MAX_STARTS_PER_MINUTE = envInt("FAWS_EXEC_MAX_STARTS_PER_MINUTE", 20);
const SCROLLBACK_BYTES = envInt("FAWS_EXEC_SCROLLBACK_BYTES", 256 * 1024);

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function timersFromEnv(): SessionTimers {
  return {
    connectMs: envInt("FAWS_EXEC_CONNECT_MS", DEFAULT_TIMERS.connectMs),
    graceMs: envInt("FAWS_EXEC_GRACE_MS", DEFAULT_TIMERS.graceMs),
    // Off by default: a shell left open on purpose is the normal case.
    idleMs: Number.parseInt(process.env["FAWS_EXEC_IDLE_MS"] ?? "0", 10) || 0,
  };
}

/** What the registry needs from whoever is currently holding the session. */
export interface SessionClient {
  data(chunk: Uint8Array): void;
  exit(code: number | null, reason: string | null): void;
  error(code: string, userMessage: string): void;
  status(message: string): void;
  prompt(prompt: ExecPrompt): void;
}

interface Session {
  readonly id: string;
  readonly kind: ExecHandshakeAuth["kind"];
  readonly target: string;
  readonly profile: string | null;
  readonly region: string | null;
  readonly startedAt: string;
  readonly machine: SessionMachine;
  readonly buffer: OutputRingBuffer;
  readonly broker: PromptBroker;
  client: SessionClient | null;
  driver: ExecDriver | null;
  readonly recorder: Recorder | null;
  /** Geometry the client last reported, replayed to the driver on reattach. */
  cols: number;
  rows: number;
}

const sessions = new Map<string, Session>();
const recentStarts: number[] = [];

function schedule(ms: number, fn: () => void): () => void {
  const handle = setTimeout(fn, ms);
  // A pending session timer must not be the reason the process stays up.
  handle.unref?.();
  return () => clearTimeout(handle);
}

/** A label for logs and the sessions list; never a secret. */
function describeTarget(auth: ExecHandshakeAuth): string {
  switch (auth.kind) {
    case "ecs":
      return `${auth.cluster}/${auth.taskId}/${auth.containerName}`;
    case "ssm":
      return auth.instanceId;
    case "ssh":
      return auth.transport.via === "direct" || auth.transport.via === "jump"
        ? auth.transport.host
        : auth.transport.instanceId;
  }
}

function scopeOf(auth: ExecHandshakeAuth): { profile: string | null; region: string | null } {
  if (auth.kind === "ecs" || auth.kind === "ssm") {
    return { profile: auth.profile, region: auth.region };
  }
  const transport = auth.transport;
  if (transport.via === "ec2-instance-connect" || transport.via === "ssm-tunnel") {
    return { profile: transport.profile, region: transport.region };
  }
  return { profile: null, region: null };
}

function admitStart(): void {
  const now = Date.now();
  while (recentStarts.length > 0 && now - (recentStarts[0] ?? 0) > 60_000) recentStarts.shift();
  if (sessions.size >= MAX_CONCURRENT) {
    throw new ExecSessionError(
      "TooManySessions",
      `Already running ${MAX_CONCURRENT} sessions. Close one before opening another.`,
    );
  }
  if (recentStarts.length >= MAX_STARTS_PER_MINUTE) {
    throw new ExecSessionError(
      "TooManySessions",
      "Too many sessions started in the last minute. Wait a moment and try again.",
    );
  }
  recentStarts.push(now);
}

/**
 * Binds a client to a session, resuming an existing one when the id matches.
 *
 * A reattach that finds nothing starts fresh rather than erroring: reloading
 * the page after a session genuinely ended should just work, not present a
 * failure the user has to dismiss.
 */
export async function attachSession(
  auth: ExecHandshakeAuth,
  client: SessionClient,
  factory: ExecDriverFactory,
): Promise<{ resumed: boolean }> {
  const existing = sessions.get(auth.sessionId);
  if (existing && !existing.machine.isTerminal) {
    resume(existing, auth, client);
    return { resumed: true };
  }

  admitStart();
  await start(auth, client, factory);
  return { resumed: false };
}

function resume(session: Session, auth: ExecHandshakeAuth, client: SessionClient): void {
  session.client = client;
  session.machine.transition("running");
  session.cols = auth.cols;
  session.rows = auth.rows;

  // Size the far end before replaying, so the bytes land in a terminal the
  // shape the client actually has.
  session.driver?.resize(auth.cols, auth.rows);

  const snapshot = session.buffer.snapshot();
  if (snapshot.length > 0) client.data(snapshot);
  log.info({ sessionId: session.id, bytes: snapshot.length }, "session resumed");
}

async function start(
  auth: ExecHandshakeAuth,
  client: SessionClient,
  factory: ExecDriverFactory,
): Promise<void> {
  const scope = scopeOf(auth);
  const sessionLog = log.child({ sessionId: auth.sessionId, kind: auth.kind });

  const session: Session = {
    id: auth.sessionId,
    kind: auth.kind,
    target: describeTarget(auth),
    profile: scope.profile,
    region: scope.region,
    startedAt: new Date().toISOString(),
    machine: new SessionMachine({
      timers: timersFromEnv(),
      schedule,
      onEnter: (state, previous) => {
        sessionLog.info(
          { from: previous.name, to: state.name, reason: state.reason },
          "session state",
        );
        if (state.name === "closing") void closeSession(auth.sessionId, state.reason ?? "closing");
      },
    }),
    buffer: new OutputRingBuffer(SCROLLBACK_BYTES),
    broker: new PromptBroker({
      deliver: (prompt) => {
        if (!session.client) return false;
        session.client.prompt(prompt);
        return true;
      },
      schedule,
    }),
    client,
    driver: null,
    recorder: auth.record
      ? startRecording({
          sessionId: auth.sessionId,
          kind: auth.kind,
          target: describeTarget(auth),
          profile: scope.profile,
          region: scope.region,
          cols: auth.cols,
          rows: auth.rows,
        })
      : null,
    cols: auth.cols,
    rows: auth.rows,
  };

  sessions.set(auth.sessionId, session);

  const sink: ExecSink = {
    data: (chunk) => {
      session.buffer.append(chunk);
      session.recorder?.output(chunk);
      session.client?.data(chunk);
    },
    exit: (code, reason) => {
      session.client?.exit(code, reason);
      session.machine.transition("closing", { reason: reason ?? "driver exited", code });
    },
    error: (code, userMessage) => session.client?.error(code, userMessage),
    status: (message) => session.client?.status(message),
  };

  const abort = new AbortController();

  try {
    session.driver = await factory(auth, sink, {
      log: sessionLog,
      signal: abort.signal,
      ask: (prompt) => session.broker.ask(prompt),
    });
  } catch (err) {
    sessions.delete(auth.sessionId);
    session.recorder?.close();
    session.machine.dispose();
    session.broker.close("the session failed to start");
    throw err;
  }

  session.machine.transition("running");
  if (session.recorder) client.status(`Recording to ${session.recorder.path}`);
}

export function writeToSession(sessionId: string, chunk: Uint8Array): void {
  const session = sessions.get(sessionId);
  if (!session || session.machine.isTerminal) return;
  session.machine.noteInput();
  session.recorder?.input(chunk);
  session.driver?.write(chunk);
}

export function resizeSession(sessionId: string, cols: number, rows: number): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.cols = cols;
  session.rows = rows;
  session.recorder?.resize(cols, rows);
  session.driver?.resize(cols, rows);
}

export function answerSessionPrompt(sessionId: string, response: ExecPromptResponse): void {
  sessions.get(sessionId)?.broker.answer(response);
}

/**
 * The client's socket went away. The session is held for the grace window
 * rather than torn down, so a dropped websocket does not kill a running shell.
 */
export function detachSession(sessionId: string, reason: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.client = null;
  // Outstanding questions are refused now rather than at their own timeout:
  // a driver blocked on something nobody can see holds a connection for nothing.
  session.broker.abandon("the client disconnected before answering");
  session.machine.transition("detached", { reason });
}

export async function closeSession(sessionId: string, reason: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);

  session.broker.close(reason);
  try {
    await session.driver?.close(reason);
  } catch (err) {
    log.warn({ err, sessionId }, "driver close failed");
  }
  session.recorder?.close();
  session.machine.transition("closed", { reason });
  session.machine.dispose();
  session.buffer.clear();
}

/** Tears everything down on shutdown, so no plugin child outlives the server. */
export async function closeAllSessions(reason: string): Promise<void> {
  await Promise.all([...sessions.keys()].map((id) => closeSession(id, reason)));
}

export function listSessions(): ReadonlyArray<{
  sessionId: string;
  kind: ExecHandshakeAuth["kind"];
  target: string;
  profile: string | null;
  region: string | null;
  startedAt: string;
  state: string;
  recordingPath: string | null;
}> {
  return [...sessions.values()].map((session) => ({
    sessionId: session.id,
    kind: session.kind,
    target: session.target,
    profile: session.profile,
    region: session.region,
    startedAt: session.startedAt,
    state: session.machine.state.name,
    recordingPath: session.recorder?.path ?? null,
  }));
}
