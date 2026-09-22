/**
 * Turning a Kubernetes failure into something with a next step in it.
 *
 * Two entry points, and the difference between them matters. `translateKubeError`
 * handles a fault we caught ourselves - a spawn that failed, a pre-flight call
 * that came back refusing - and those carry a real exit status and a clean
 * stderr, so their codes are trustworthy.
 *
 * `classifyKubeOutput` reads the child's own output, and it is the fallback
 * rather than the plan. Under node-pty stderr is merged into stdout on the same
 * fd, by design, so there is no way to isolate a diagnostic from whatever the
 * shell had already printed. Matching on it is a guess made from good
 * evidence. When it does not match, the exit keeps the behaviour every other
 * driver has: the code, the reason, and the output already on screen.
 */
import type { ExecErrorCode } from "@faws/contracts";

import { ExecSessionError, isExecSessionError } from "../errors.ts";

export interface KubeClassification {
  readonly code: ExecErrorCode;
  readonly message: string;
}

/** The patterns, most specific first: several of these overlap. */
const PATTERNS: ReadonlyArray<{ test: RegExp; code: ExecErrorCode; message: string }> = [
  {
    test: /container\s+(?:named\s+)?["']?[\w.-]*["']?\s+(?:is\s+)?not\s+found|container not valid for pod|unable to find container named/i,
    code: "KubeContainerNotFound",
    message:
      "That container is not in the pod. Pick one of the containers the pod actually lists; the set changes when the deployment does.",
  },
  {
    test: /pods?\s+["'][^"']*["']\s+not found|error from server \(notfound\)/i,
    code: "KubePodNotFound",
    message:
      "That pod is gone. Pods are replaced rather than restarted, so the name changes on every rollout - reload the list and try the current one.",
  },
  {
    test: /virtualmachineinstance[^\n]*not found|vmi[^\n]*not found|is not running|in phase (?:pending|scheduling|failed|succeeded)/i,
    code: "KubeVmNotRunning",
    message:
      "That virtual machine is not running, so there is nothing to attach to. Start it and try again.",
  },
  {
    test: /the server doesn't have a resource type ["']?virtualmachine|no matches for kind ["']?virtualmachine|unable to recognize[^\n]*kubevirt/i,
    code: "KubeVirtUnavailable",
    message: "KubeVirt is not installed on this cluster, so it has no virtual machines to reach.",
  },
  {
    test: /context ["'][^"']*["'] does not exist|no context exists with the name/i,
    code: "KubeContextUnknown",
    message:
      "That context is not in your kubeconfig any more. Reload the contexts list and pick one that is.",
  },
  {
    test: /error loading config file|stat [^\n]*: no such file or directory[^\n]*kubeconfig|no configuration has been provided/i,
    code: "KubeconfigMissing",
    message:
      "No kubeconfig could be read. Set KUBECONFIG, or put a config at ~/.kube/config, then reopen this panel.",
  },
  {
    test: /is forbidden:|cannot (?:create|get) resource|rbac: access denied/i,
    code: "KubeForbidden",
    message:
      "Your account is allowed to see this but not to exec into it. Exec is a separate permission (`pods/exec`) from listing pods, so a role that shows you the workload can still refuse the shell.",
  },
  {
    test: /error: you must be logged in|unauthorized|invalid bearer token|the server has asked for the client to provide credentials/i,
    code: "KubeAuthFailed",
    message:
      "The cluster refused those credentials. They are usually short-lived - log in again with whatever your context authenticates through, then retry.",
  },
  {
    test: /exec plugin|getting credentials: exec|executable [\w.-]+ (?:not found|failed)/i,
    code: "KubeAuthFailed",
    message:
      "This context authenticates through an exec credential plugin, and that plugin failed. Run the same `kubectl` command in a terminal to see what it is asking for.",
  },
  {
    test: /unable to connect to the server|dial tcp|connection refused|no such host|i\/o timeout|couldn't get current server api group list|tls: |certificate signed by unknown authority/i,
    code: "KubeApiUnreachable",
    message:
      "The cluster's API server could not be reached. Check you are on the network or VPN it sits behind, and that the server URL in the context is still right.",
  },
];

/**
 * Reads the child's output for a cause worth naming.
 *
 * Only ever consulted on a non-zero exit: the same words appearing in an
 * interactive shell's own output are not a diagnostic, and a session that ended
 * cleanly had no failure to explain.
 */
export function classifyKubeOutput(
  text: string,
  exitCode: number | null,
): KubeClassification | null {
  if (exitCode === 0 || exitCode === null) return null;
  for (const pattern of PATTERNS) {
    if (pattern.test.test(text)) return { code: pattern.code, message: pattern.message };
  }
  return null;
}

/** A fault we raised or caught, rather than one read off the screen. */
export function translateKubeError(err: unknown): ExecSessionError {
  if (isExecSessionError(err)) return err;

  const code = (err as { code?: string }).code;
  const message = err instanceof Error ? err.message : String(err);

  // A binary that resolved a moment ago and will not spawn now is the same
  // problem as one that was never there, and has the same answer.
  if (code === "ENOENT" || code === "EACCES") {
    return new ExecSessionError(
      "KubeBinaryMissing",
      `That command could not be run: ${message}. Check the binary is installed and executable.`,
    );
  }

  const classified = classifyKubeOutput(message, 1);
  if (classified) return new ExecSessionError(classified.code, classified.message);

  return new ExecSessionError("Internal", message);
}
