/**
 * The argument vector for a Kubernetes shell.
 *
 * Pure, and separated from the driver, because this is the part where a
 * mistake is a security bug rather than a broken session. Two rules hold
 * throughout and both are load-bearing:
 *
 * Everything user-supplied is passed as `--flag=value`, never as `--flag value`.
 * In the two-token form a value that begins with a dash is read as the next
 * flag instead, and the contract's name regexes are the other half of the same
 * fence. And `--` closes the flag list before the command, so nothing the
 * person typed to run inside the container can be mistaken for something meant
 * for `kubectl`.
 *
 * The context and the kubeconfig ride in flags rather than the environment.
 * `spawnInteractive` hands the child `process.env` wholesale, so a per-session
 * `KUBECONFIG` would mean mutating shared process state that other sessions are
 * reading. Flags are also visible in the log line and in `ps`, which is exactly
 * the property you want for "which cluster did that shell go to".
 */
import type { ExecHandshakeAuth } from "@faws/contracts";

import { ExecSessionError } from "../errors.ts";

export type KubeExecAuth = Extract<ExecHandshakeAuth, { kind: "kube" }>;

export interface KubeBinaries {
  readonly kubectl: string | null;
  readonly oc: string | null;
  readonly virtctl: string | null;
  /**
   * The one kubeconfig file to pin, when the resolved set is a single file.
   * Null when `KUBECONFIG` names several, where the merged view is the thing
   * the context was validated against and only the inherited env describes it.
   */
  readonly kubeconfig: string | null;
}

export interface KubeArgv {
  readonly file: string;
  readonly args: readonly string[];
}

export function buildKubeArgv(auth: KubeExecAuth, binaries: KubeBinaries): KubeArgv {
  const { target } = auth;
  const file = requireBinary(target.tool, binaries);
  const scope = [
    ...(binaries.kubeconfig ? [`--kubeconfig=${binaries.kubeconfig}`] : []),
    `--context=${auth.context}`,
    `--namespace=${auth.namespace}`,
  ];

  switch (target.tool) {
    case "kubectl":
      return {
        file,
        args: [
          ...scope,
          "exec",
          "--stdin",
          "--tty",
          target.pod,
          ...container(target.container),
          "--",
          ...target.command,
        ],
      };
    case "oc":
      return target.mode === "exec"
        ? {
            file,
            args: [
              ...scope,
              "exec",
              "--stdin",
              "--tty",
              target.pod,
              ...container(target.container),
              "--",
              ...target.command,
            ],
          }
        : {
            // `oc rsh` takes the command as trailing positionals and rejects a
            // `--` of its own, so this is the one form without the separator.
            file,
            args: [
              ...scope,
              "rsh",
              "--tty",
              ...container(target.container),
              target.pod,
              ...target.command,
            ],
          };
    case "virtctl":
      return target.mode === "console"
        ? { file, args: [...scope, "console", target.vm] }
        : {
            file,
            args: [
              ...scope,
              "ssh",
              target.user ? `${target.user}@${target.vm}` : target.vm,
              // The default shells out to the system `ssh`, which asks about
              // host keys on a TTY the child owns and we cannot answer through.
              // The native implementation has no prompt to get stuck behind.
              "--local-ssh=false",
            ],
          };
  }
}

function container(name: string | undefined): string[] {
  return name ? [`--container=${name}`] : [];
}

function requireBinary(tool: KubeExecAuth["target"]["tool"], binaries: KubeBinaries): string {
  const found = binaries[tool];
  if (found) return found;
  throw new ExecSessionError("KubeBinaryMissing", `${tool} was not found on this machine.`);
}
