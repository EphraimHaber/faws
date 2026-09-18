/**
 * Connecting one SSH hop.
 *
 * One hop, because a jump chain is just this applied repeatedly: each hop
 * verifies its own host key, authenticates on its own terms, and hands the next
 * one a forwarded channel to ride on. Keeping it to a single hop is what makes
 * `ProxyJump a,b,c` fall out as a loop rather than a special case.
 */
import * as fs from "node:fs";
import * as os from "node:os";

import type { ExecPrompt, ExecPromptResponse } from "@faws/contracts";
import { readSshConfig, resolveSshHost } from "@faws/core";
import { Client, type ConnectConfig } from "ssh2";
import type { Duplex } from "node:stream";

import { ExecSessionError } from "../errors.ts";
import {
  appendKnownHost,
  defaultKnownHostsPath,
  fingerprint,
  knownHostsLine,
  readKnownHosts,
  verifyHostKey,
} from "./knownHosts.ts";

export interface HopContext {
  status(message: string): void;
  ask(prompt: ExecPrompt): Promise<ExecPromptResponse>;
  log: { info(obj: unknown, msg: string): void };
  signal: AbortSignal;
}

export interface HopSpec {
  /** A hostname, or a Host alias to resolve through ~/.ssh/config. */
  readonly target: string;
  readonly user?: string | undefined;
  readonly port?: number | undefined;
  /** A stream to ride on instead of dialling: a tunnel, or a forwarded channel. */
  readonly sock?: Duplex | undefined;
  /** Offered before anything on disk; used by EC2 Instance Connect. */
  readonly privateKey?: Buffer | undefined;
}

export interface Hop {
  readonly client: Client;
  readonly host: string;
  readonly port: number;
  readonly user: string;
}

export function translateSshError(err: unknown, user?: string): ExecSessionError {
  if (err instanceof ExecSessionError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const level = (err as { level?: string }).level;

  if (level === "client-authentication" || /authentication/i.test(message)) {
    return new ExecSessionError(
      "AuthFailed",
      user === undefined
        ? "The server refused every key we offered. Check the user, and that your key is loaded in ssh-agent (SSH_AUTH_SOCK is how this app finds it)."
        : `The server refused the key for \`${user}\`. The login name is the usual cause - AMIs differ (ec2-user, ubuntu, admin, rocky), and EC2 Instance Connect only installs the key for the user it was asked for. Otherwise, check your key is loaded in ssh-agent.`,
    );
  }
  if (/timed out|ETIMEDOUT/i.test(message)) {
    return new ExecSessionError(
      "ConnectTimeout",
      "The host did not answer. If it has no public address, reach it with an SSM tunnel instead.",
    );
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return new ExecSessionError("ConnectTimeout", "That hostname does not resolve.");
  }
  if (/ECONNREFUSED/i.test(message)) {
    return new ExecSessionError(
      "ConnectTimeout",
      "The host refused the connection on that port. Check sshd is listening and the security group allows it.",
    );
  }
  return new ExecSessionError("Internal", message);
}

function readIdentity(file: string): Buffer | null {
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

export async function connectHop(spec: HopSpec, ctx: HopContext): Promise<Hop> {
  const resolved = resolveSshHost(readSshConfig(), spec.target);

  for (const { directive, reason } of resolved.rejected) {
    // Said out loud rather than skipped: a config that is half-applied sends
    // you to a different machine than the one you asked for.
    ctx.status(`Ignoring ${directive} from ~/.ssh/config - ${reason}`);
  }

  const host = resolved.hostName;
  const port = spec.port ?? resolved.port ?? 22;
  const user = spec.user ?? resolved.user ?? os.userInfo().username;
  const knownHostsFile = defaultKnownHostsPath();

  ctx.status(`Connecting to ${user}@${host}:${port}...`);

  const client = new Client();

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      client.end();
      reject(translateSshError(err, user));
    };

    client.on("error", fail);
    ctx.signal.addEventListener("abort", () => fail(new Error("the client went away")), {
      once: true,
    });
    client.on("ready", () => {
      settled = true;
      resolve();
    });

    const identities = resolved.identityFiles
      .map((file) => readIdentity(file))
      .filter((key): key is Buffer => key !== null);

    const config: ConnectConfig = {
      host,
      port,
      username: user,
      // Disabled deliberately: a host-key prompt happens in the middle of this
      // handshake and ssh2's timer cannot be paused, so someone taking a minute
      // to compare a fingerprint would lose the connection. The session's own
      // connect timer owns this deadline and stands down while a person is
      // being asked something.
      readyTimeout: 0,
      ...(resolved.keepaliveIntervalMs ? { keepaliveInterval: resolved.keepaliveIntervalMs } : {}),
      ...(spec.sock ? { sock: spec.sock } : {}),
      // An ephemeral Instance Connect key is used on its own, with the agent
      // deliberately left out. sshd commonly stops after six failed attempts,
      // and a full agent would spend all of them before ever reaching the key
      // that was pushed for this session - which then looks like the push
      // failed rather than like we never offered it.
      ...(spec.privateKey
        ? { privateKey: spec.privateKey }
        : {
            ...(identities.length > 0 ? { privateKey: identities[0] } : {}),
            // The agent is how most people already hold their keys, so there is
            // no passphrase prompt and no key material passes through here.
            // IdentitiesOnly means the config asked us not to use it.
            ...(process.env["SSH_AUTH_SOCK"] && !resolved.identitiesOnly
              ? { agent: resolved.identityAgent ?? process.env["SSH_AUTH_SOCK"] }
              : {}),
          }),
      // Keyboard-interactive needs its own prompt roundtrip; until that exists,
      // saying so beats hanging on a question nobody can see.
      tryKeyboard: false,
      hostVerifier: (key: Buffer, verified: (ok: boolean) => void) => {
        void (async () => {
          try {
            verified(await approveHostKey(key, host, port, knownHostsFile, ctx));
          } catch (err) {
            fail(err);
            verified(false);
          }
        })();
      },
    };

    client.connect(config);
  });

  return { client, host, port, user };
}

async function approveHostKey(
  key: Buffer,
  host: string,
  port: number,
  knownHostsFile: string,
  ctx: HopContext,
): Promise<boolean> {
  // ssh2 hands over the wire-format key; its type is the first length-prefixed
  // string inside it, which is also what known_hosts records.
  const keyBase64 = key.toString("base64");
  const typeLength = key.readUInt32BE(0);
  const keyType = key.subarray(4, 4 + typeLength).toString("utf8");

  const verdict = verifyHostKey(
    readKnownHosts(knownHostsFile),
    knownHostsFile,
    host,
    port,
    keyType,
    keyBase64,
  );

  switch (verdict.outcome) {
    case "trusted":
      return true;

    case "changed":
      throw new ExecSessionError(
        "HostKeyChanged",
        `The host key for ${host} has changed since it was recorded. This can mean the host was rebuilt - or that something is impersonating it. Nothing here will connect until you decide which: the recorded key is ${knownHostsFile} line ${verdict.line}, and \`ssh-keygen -R ${host}\` removes it.`,
      );

    case "revoked":
      throw new ExecSessionError(
        "HostKeyChanged",
        `The key ${host} presented is marked @revoked in ${knownHostsFile}.`,
      );

    case "unparseable":
      throw new ExecSessionError(
        "KnownHostsUnparseable",
        `${knownHostsFile} line ${verdict.line} concerns ${host} but cannot be read, so this host's identity cannot be checked. Fix or remove that line.`,
      );

    case "unknown": {
      const line = knownHostsLine(host, port, keyType, keyBase64);
      const response = await ctx.ask({
        kind: "hostkey",
        promptId: crypto.randomUUID(),
        host,
        port,
        keyType,
        fingerprintSha256: fingerprint(keyBase64),
        knownHostsLine: line,
      });

      if (response.trust === "permanent") {
        appendKnownHost(knownHostsFile, line);
        ctx.log.info({ host, port, keyType }, "recorded a new host key");
        return true;
      }
      if (response.trust === "once") return true;
      throw new ExecSessionError("HostKeyRejected", `The host key for ${host} was not accepted.`);
    }
  }
}

/** Opens a channel through an established hop, for the next one to ride on. */
export function forwardThrough(hop: Hop, host: string, port: number): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    hop.client.forwardOut("127.0.0.1", 0, host, port, (err, channel) => {
      if (err) {
        reject(
          new ExecSessionError(
            "Internal",
            `${hop.host} could not open a channel to ${host}:${port}. (${err.message})`,
          ),
        );
        return;
      }
      resolve(channel as unknown as Duplex);
    });
  });
}
