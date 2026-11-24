/**
 * What this machine looks set up for, so the first-run screen can suggest
 * which providers to turn on instead of asking someone to guess.
 *
 * Every check is a file or a binary on disk. None of them talks to a network
 * or runs a provider's CLI, because detecting AWS by asking AWS is exactly
 * what someone who has no cloud does not want this app doing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ProviderId } from "@faws/contracts";

import { settingsStore } from "../settings/settings.instance.ts";
import { existingKubeconfigPaths, resolveKubeBinary } from "@faws/provider-kubernetes/server";

export interface ProviderDetection {
  readonly id: ProviderId;
  /** Whether this machine looks like it uses the provider. */
  readonly found: boolean;
  /** One sentence saying what was or was not found, for the toggle's hint. */
  readonly evidence: string;
}

export function detectProviders(): ProviderDetection[] {
  return [detectAws(), detectKubernetes(), detectS3Endpoints()];
}

function detectAws(): ProviderDetection {
  const env = process.env;
  if (env["AWS_ACCESS_KEY_ID"] || env["AWS_PROFILE"]) {
    return { id: "aws", found: true, evidence: "AWS credentials are set in the environment." };
  }
  const home = os.homedir();
  const files = [
    env["AWS_CONFIG_FILE"] ?? path.join(home, ".aws", "config"),
    env["AWS_SHARED_CREDENTIALS_FILE"] ?? path.join(home, ".aws", "credentials"),
  ];
  const present = files.filter((file) => fs.existsSync(file));
  return present.length > 0
    ? { id: "aws", found: true, evidence: `Found ${present.map(tilde).join(" and ")}.` }
    : { id: "aws", found: false, evidence: "No AWS config or credentials file on this machine." };
}

function detectKubernetes(): ProviderDetection {
  const configs = existingKubeconfigPaths();
  const kubectl = resolveKubeBinary("kubectl");
  const oc = resolveKubeBinary("oc");
  const tool = kubectl.path ? "kubectl" : oc.path ? "oc" : null;
  if (configs.length > 0 && tool) {
    return {
      id: "kubernetes",
      found: true,
      evidence: `Found ${configs.map(tilde).join(", ")} and ${tool}.`,
    };
  }
  if (configs.length > 0) {
    return {
      id: "kubernetes",
      found: false,
      evidence: `Found ${configs.map(tilde).join(", ")}, but neither kubectl nor oc.`,
    };
  }
  return { id: "kubernetes", found: false, evidence: "No kubeconfig on this machine." };
}

function detectS3Endpoints(): ProviderDetection {
  const count = settingsStore().get().settings.providers.s3.connections.length;
  return count > 0
    ? { id: "s3", found: true, evidence: `${count} saved endpoint${count === 1 ? "" : "s"}.` }
    : {
        id: "s3",
        found: false,
        evidence: "No saved endpoints yet; add MinIO, Ceph or any S3-compatible server later.",
      };
}

function tilde(file: string): string {
  const home = os.homedir();
  return file.startsWith(home) ? `~${file.slice(home.length)}` : file;
}
