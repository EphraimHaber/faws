/**
 * EC2 Instance Connect: a key that exists for sixty seconds.
 *
 * `SendSSHPublicKey` pushes a public key onto an instance, where the agent
 * accepts it for about a minute. So a session generates a keypair in memory,
 * pushes the public half, connects with the private half, and lets both fall
 * out of scope - no key file, no passphrase to store, nothing to rotate, and
 * nothing left behind on the instance.
 *
 * The private half never touches disk and is never handed to a child process.
 * It is held as a Buffer rather than a string specifically so it can be zeroed
 * after the handshake: a string is immutable and would sit in the heap until
 * the collector felt like it.
 */
import * as crypto from "node:crypto";

import { SendSSHPublicKeyCommand } from "@aws-sdk/client-ec2-instance-connect";
import type { AwsScope } from "@faws/contracts";
import { ec2InstanceConnectClient } from "@faws/core";

import { ExecSessionError } from "../errors.ts";

export interface EphemeralKey {
  readonly privateKey: Buffer;
  readonly publicKeyOpenSsh: string;
  /** Zeroes the private key. Call once the handshake is done with it. */
  scrub(): void;
}

/** An SSH mpint: big-endian, padded when the top bit would read as negative. */
function sshInteger(base64url: string): Buffer {
  const raw = Buffer.from(base64url, "base64url");
  return (raw[0] ?? 0) & 0x80 ? Buffer.concat([Buffer.from([0]), raw]) : raw;
}

/** One length-prefixed field of an SSH wire-format blob. */
function sshField(value: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(value.length, 0);
  return Buffer.concat([length, value]);
}

/**
 * Converts an RSA public key to the `ssh-rsa AAAA...` wire format.
 *
 * The blob is three length-prefixed fields: the algorithm name, the exponent
 * and the modulus, each a big-endian integer with a leading zero byte when the
 * top bit is set. Node gives us the two integers via JWK, which avoids parsing
 * DER by hand.
 */
function toOpenSshRsa(key: crypto.KeyObject): string {
  const jwk = key.export({ format: "jwk" });
  if (!jwk.n || !jwk.e) throw new Error("RSA key export produced no modulus");

  const blob = Buffer.concat([
    sshField(Buffer.from("ssh-rsa", "utf8")),
    sshField(sshInteger(jwk.e)),
    sshField(sshInteger(jwk.n)),
  ]);
  return `ssh-rsa ${blob.toString("base64")}`;
}

/**
 * RSA rather than ed25519, which is the better algorithm and was the first
 * choice.
 *
 * ssh2 cannot read the PKCS8 PEM that Node exports an ed25519 private key as -
 * it wants OpenSSH's own container, which Node will not produce - so using
 * ed25519 here would mean hand-encoding `openssh-key-v1` for a key that lives
 * for sixty seconds. RSA-2048 in PKCS1 is parsed by both sides, is accepted by
 * Instance Connect, and is entirely adequate for a key with that lifetime.
 */
export function generateEphemeralKey(): EphemeralKey {
  // Both halves stay KeyObjects here; the private one is exported to the PEM
  // ssh2 reads, and the public one is read through JWK rather than DER.
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  const privateBuffer = Buffer.from(
    privateKey.export({ type: "pkcs1", format: "pem" }) as string,
    "utf8",
  );
  return {
    privateKey: privateBuffer,
    publicKeyOpenSsh: toOpenSshRsa(publicKey),
    scrub: () => privateBuffer.fill(0),
  };
}

/**
 * Pushes a public key to an instance.
 *
 * The AZ is required by the API and comes from the same DescribeInstances data
 * the picker already fetched, so this adds no extra call.
 */
export async function sendPublicKey(
  scope: AwsScope,
  input: {
    instanceId: string;
    osUser: string;
    availabilityZone: string;
    publicKeyOpenSsh: string;
  },
): Promise<void> {
  const client = ec2InstanceConnectClient(scope);

  try {
    await client.send(
      new SendSSHPublicKeyCommand({
        InstanceId: input.instanceId,
        InstanceOSUser: input.osUser,
        AvailabilityZone: input.availabilityZone,
        SSHPublicKey: input.publicKeyOpenSsh,
      }),
    );
  } catch (err) {
    throw translate(err, input);
  }
}

function translate(err: unknown, input: { instanceId: string; osUser: string }): ExecSessionError {
  const name = (err as { name?: string }).name ?? "Unknown";
  const message = err instanceof Error ? err.message : String(err);

  switch (name) {
    case "AuthException":
    case "AccessDeniedException":
      return new ExecSessionError(
        "InstanceConnectFailed",
        `Not allowed to push a key to ${input.instanceId}. This needs ec2-instance-connect:SendSSHPublicKey for that instance, and the policy commonly restricts which OS user it may be sent for.`,
      );
    case "InvalidInstanceId":
      return new ExecSessionError(
        "InvalidInstanceId",
        `${input.instanceId} is not an instance this region knows about.`,
      );
    case "EC2InstanceNotFoundException":
      return new ExecSessionError(
        "InvalidInstanceId",
        `${input.instanceId} was not found. Instance Connect also needs the instance to be running.`,
      );
    case "EC2InstanceStateInvalidException":
      return new ExecSessionError(
        "InstanceConnectFailed",
        `${input.instanceId} is not in a state that accepts a key.`,
      );
    case "ServiceException":
    case "ThrottlingException":
      return new ExecSessionError("InstanceConnectFailed", `EC2 Instance Connect: ${message}`);
    default:
      return new ExecSessionError(
        "InstanceConnectFailed",
        `Could not push a key to ${input.instanceId} for ${input.osUser}. Instance Connect needs a recent Amazon Linux or Ubuntu AMI with the ec2-instance-connect package. (${message})`,
      );
  }
}
