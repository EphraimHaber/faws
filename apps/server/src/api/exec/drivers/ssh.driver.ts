/**
 * An SSH shell, over ssh2.
 *
 * PTY and resize come from the SSH protocol itself rather than from a local
 * pseudo-terminal: `shell({cols, rows})` sizes the far end and
 * `setWindow(rows, cols)` changes it, so none of the node-pty machinery the SSM
 * driver needs applies here.
 *
 * Host keys are verified against ~/.ssh/known_hosts, and an unknown one asks
 * the person rather than deciding for them. A refusal, a timeout, or a closed
 * tab all fail the connection - the prompt broker turns every non-answer into a
 * rejection, so there is no path through this file that trusts a key nobody
 * approved.
 */
import * as os from "node:os";

import { Client, type ClientChannel, type ConnectConfig } from "ssh2";

import { ExecSessionError } from "../errors.ts";
import type { ExecDriver, ExecDriverFactory } from "../exec.service.ts";
import {
  appendKnownHost,
  defaultKnownHostsPath,
  fingerprint,
  knownHostsLine,
  readKnownHosts,
  verifyHostKey,
} from "../ssh/knownHosts.ts";

function translate(err: unknown): ExecSessionError {
  const message = err instanceof Error ? err.message : String(err);
  const level = (err as { level?: string }).level;

  if (level === "client-authentication" || /authentication/i.test(message)) {
    return new ExecSessionError(
      "AuthFailed",
      "The server refused every key we offered. Check the user, and that your key is loaded in ssh-agent (SSH_AUTH_SOCK is how this app finds it).",
    );
  }
  if (/timed out|ETIMEDOUT/i.test(message)) {
    return new ExecSessionError(
      "ConnectTimeout",
      "The host did not answer. It may be in a private subnet - an SSM tunnel reaches those without a public address.",
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

export const sshDriverFactory: ExecDriverFactory = async (auth, sink, ctx) => {
  if (auth.kind !== "ssh") {
    throw new ExecSessionError("Internal", "The SSH driver got a non-SSH handshake.");
  }
  if (auth.transport.via !== "direct") {
    throw new ExecSessionError(
      "Internal",
      `The ${auth.transport.via} transport is not available in this build yet.`,
    );
  }

  const host = auth.transport.host;
  const port = auth.port ?? 22;
  const user = auth.user ?? os.userInfo().username;
  const knownHostsFile = defaultKnownHostsPath();

  sink.status(`Connecting to ${user}@${host}:${port}...`);

  const client = new Client();

  const channel = await new Promise<ClientChannel>((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      client.end();
      reject(err instanceof ExecSessionError ? err : translate(err));
    };

    client.on("error", fail);
    ctx.signal.addEventListener("abort", () => fail(new Error("the client went away")), {
      once: true,
    });

    client.on("ready", () => {
      client.shell({ term: "xterm-256color", cols: auth.cols, rows: auth.rows }, (err, stream) => {
        if (err) {
          fail(err);
          return;
        }
        settled = true;
        resolve(stream);
      });
    });

    const config: ConnectConfig = {
      host,
      port,
      username: user,
      // Disabled deliberately. A host-key prompt happens in the middle of this
      // handshake, and ssh2's timer cannot be paused - so someone taking a
      // minute to compare a fingerprint would time out the connection. The
      // session's own connect timer owns this deadline and stands down while a
      // person is being asked something.
      readyTimeout: 0,
      // Agent first: it is how most people already hold their keys, and it
      // means no passphrase prompt and no key material passing through here.
      ...(process.env["SSH_AUTH_SOCK"] ? { agent: process.env["SSH_AUTH_SOCK"] } : {}),
      // Keyboard-interactive would need its own prompt roundtrip; until that
      // exists, saying so beats hanging on a prompt nobody can see.
      tryKeyboard: false,
      hostVerifier: (key: Buffer, verified: (ok: boolean) => void) => {
        void (async () => {
          try {
            verified(await approveHostKey(key));
          } catch (err) {
            fail(err);
            verified(false);
          }
        })();
      },
    };

    client.connect(config);
  });

  async function approveHostKey(key: Buffer): Promise<boolean> {
    // ssh2 hands us the wire-format key; its type is the first length-prefixed
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

  let closing = false;

  channel.on("data", (chunk: Buffer) => sink.data(new Uint8Array(chunk)));
  channel.stderr?.on("data", (chunk: Buffer) => sink.data(new Uint8Array(chunk)));
  channel.on("close", () => {
    if (closing) return;
    closing = true;
    sink.exit(null, "the connection closed");
    client.end();
  });
  channel.on("exit", (code: number | null) => {
    if (closing) return;
    closing = true;
    sink.exit(code, null);
  });

  const driver: ExecDriver = {
    write(chunk) {
      if (!closing) channel.write(Buffer.from(chunk));
    },
    resize(cols, rows) {
      if (!closing) channel.setWindow(rows, cols, 0, 0);
    },
    close(reason) {
      if (closing) return;
      closing = true;
      ctx.log.info({ reason, host }, "closing SSH session");
      channel.close();
      client.end();
    },
  };

  return driver;
};
