/**
 * A shell in a pod, or on a KubeVirt virtual machine, by way of the user's own
 * `kubectl`, `oc` or `virtctl`.
 *
 * The same position the SSM driver takes: the tool that ships with the platform
 * is the reference implementation, so it is spawned rather than reimplemented.
 * Here it buys more than protocol compatibility - a real kubeconfig
 * authenticates through exec credential plugins, client certificates and
 * proxies, and `kubectl` supports exactly the set the user's cluster expects.
 *
 * Almost everything below the spawn is pre-flight, and that is deliberate.
 * Under node-pty the child's stderr is merged into stdout on one fd, so a
 * diagnostic cannot be told apart from output the shell had already produced.
 * Anything we can find out before the spawn - the binary, the kubeconfig, the
 * context, whether the pod and container are even there - is a precise error
 * with a next step in it. What comes back off the child afterwards is matched
 * for a cause as a fallback, and an exit nobody recognises keeps the behaviour
 * every other driver has.
 */
import { ExecSessionError } from "../errors.ts";
import type { ExecDriver, ExecDriverFactory } from "../exec.service.ts";
import {
  buildKubeArgv,
  type KubeBinaries,
  type KubeExecAuth,
  kubeScopeFlags,
} from "../kube/argv.ts";
import { classifyKubeOutput, translateKubeError } from "../kube/translate.ts";
import { spawnInteractive, type InteractiveChild } from "../pty.ts";
import { resolveKubeBinary } from "../../kube/binaries.ts";
import { runKubeJson } from "../../kube/cli.ts";
import {
  assertKnownContext,
  existingKubeconfigPaths,
  kubeconfigPaths,
  pinnedKubeconfig,
} from "../../kube/kubeconfig.ts";

/** How long to wait for a killed child before insisting. */
const SIGKILL_AFTER_MS = 2000;

/**
 * How much of the child's output to keep for classifying an exit.
 *
 * Enough for a diagnostic and its context, and small enough that it is never
 * the reason a long-running session holds memory. The session's own ring
 * buffer is what the user sees replayed; this is only ever read on a failure.
 */
const TAIL_BYTES = 8192;

interface PodStatus {
  readonly status?: { readonly phase?: string };
  readonly spec?: { readonly containers?: ReadonlyArray<{ readonly name?: string }> };
}

export const kubeDriverFactory: ExecDriverFactory = async (auth, sink, ctx) => {
  if (auth.kind !== "kube")
    throw new ExecSessionError("Internal", "The Kubernetes driver got a non-Kubernetes handshake.");

  const binaries = resolveBinaries(auth);
  const scopeFlags = kubeScopeFlags({
    kubeconfig: binaries.kubeconfig,
    context: auth.context,
    namespace: auth.namespace,
  });

  sink.status(`Checking ${auth.context}/${auth.namespace}...`);

  if (existingKubeconfigPaths().length === 0) {
    throw new ExecSessionError(
      "KubeconfigMissing",
      `No kubeconfig was found. Looked at ${kubeconfigPaths().join(", ")}. Set KUBECONFIG, or create one, then try again.`,
    );
  }

  // The context name is the only cluster identifier that crosses the wire, and
  // this is what makes that safe: the flag's value is now a string we found in
  // our own kubeconfig rather than one the client chose.
  await assertKnownContext(auth.context, { signal: ctx.signal });

  await preflightTarget(auth, binaries, scopeFlags, ctx.signal, (message) => sink.status(message));

  const { file, args } = buildKubeArgv(auth, binaries);
  ctx.log.info({ file, args }, "starting a Kubernetes session");
  sink.status(`Connecting to ${describe(auth)}...`);

  let child: InteractiveChild;
  try {
    child = await spawnInteractive(file, [...args], {
      cols: auth.cols,
      rows: auth.rows,
      onDegraded: (why) => sink.status(why),
    });
  } catch (err) {
    throw translateKubeError(err);
  }

  let closing = false;
  let tail = "";

  child.onData((chunk) => {
    tail = (tail + new TextDecoder().decode(chunk)).slice(-TAIL_BYTES);
    sink.data(chunk);
  });

  child.onExit((code) => {
    if (closing) return;
    closing = true;
    const classified = classifyKubeOutput(tail, code);
    // The coded error decorates the exit rather than replacing it: the output
    // that produced the guess is already on screen, and dropping the exit would
    // leave the tab open on a session that has gone.
    if (classified) sink.error(classified.code, classified.message);
    sink.exit(code, code === 0 ? null : `${auth.target.tool} exited`);
  });

  const driver: ExecDriver = {
    write(chunk) {
      if (closing) return;
      child.write(chunk);
    },
    resize(cols, rows) {
      if (closing) return;
      child.resize(cols, rows);
    },
    async close(reason) {
      if (closing) return;
      closing = true;
      ctx.log.info({ reason }, "closing Kubernetes session");
      await child.kill(SIGKILL_AFTER_MS);
    },
  };

  return driver;
};

function resolveBinaries(auth: KubeExecAuth): KubeBinaries {
  const kubectl = resolveKubeBinary("kubectl");
  const oc = resolveKubeBinary("oc");
  const virtctl = resolveKubeBinary("virtctl");

  const required = { kubectl, oc, virtctl }[auth.target.tool];
  if (!required.path) {
    throw new ExecSessionError(
      "KubeBinaryMissing",
      required.problem ?? `${auth.target.tool} was not found on this machine.`,
    );
  }

  return {
    kubectl: kubectl.path,
    oc: oc.path,
    virtctl: virtctl.path,
    kubeconfig: pinnedKubeconfig(),
  };
}

/**
 * Checks the thing we are about to attach to actually exists.
 *
 * Reading uses `kubectl` even for a `virtctl` session, because `virtctl` has no
 * JSON read of its own; when there is no `kubectl` at all the check is skipped
 * rather than failing, since it is diagnosis, not permission.
 */
async function preflightTarget(
  auth: KubeExecAuth,
  binaries: KubeBinaries,
  scopeFlags: readonly string[],
  signal: AbortSignal,
  status: (message: string) => void,
): Promise<void> {
  const reader = binaries.kubectl ?? binaries.oc;
  if (!reader) return;

  if (auth.target.tool === "virtctl") {
    status(`Looking for ${auth.target.vm}...`);
    const vmi = await get<{ status?: { phase?: string } }>(
      reader,
      [...scopeFlags, "get", "virtualmachineinstance", auth.target.vm, "--output=json"],
      signal,
    );
    if (!vmi) return;
    const phase = vmi.status?.phase ?? "unknown";
    if (phase !== "Running") {
      throw new ExecSessionError(
        "KubeVmNotRunning",
        `${auth.target.vm} is ${phase}, not Running, so there is nothing to attach to. Start it and try again.`,
      );
    }
    return;
  }

  status(`Looking for ${auth.target.pod}...`);
  const pod = await get<PodStatus>(
    reader,
    [...scopeFlags, "get", "pod", auth.target.pod, "--output=json"],
    signal,
  );
  if (!pod) return;

  const phase = pod.status?.phase ?? "Unknown";
  if (phase !== "Running") {
    // Reported as "not found" on purpose. The remediation is the same one -
    // the pod you can open a shell in is not there, reload and pick a current
    // one - and a second code whose next step is identical would not earn its
    // place in that union.
    throw new ExecSessionError(
      "KubePodNotFound",
      `${auth.target.pod} is ${phase}, not Running, so it has no shell to attach to.`,
    );
  }

  const wanted = auth.target.container;
  if (!wanted) return;
  const names = (pod.spec?.containers ?? [])
    .map((entry) => entry.name)
    .filter((name): name is string => typeof name === "string");
  if (!names.includes(wanted)) {
    throw new ExecSessionError(
      "KubeContainerNotFound",
      `${auth.target.pod} has no container named "${wanted}". It has ${names.join(", ") || "none"}.`,
    );
  }
}

/**
 * Reads one object, or gives up quietly.
 *
 * A refusal here is not a refusal of the session: `get` and `pods/exec` are
 * separate permissions, and a role that grants the shell without the read is
 * unusual but legitimate. Anything else - unreachable, unauthenticated, not
 * found - is the precise answer this pre-flight exists to produce.
 */
async function get<T>(
  file: string,
  args: readonly string[],
  signal: AbortSignal,
): Promise<T | null> {
  try {
    return await runKubeJson<T>(file, args, { signal });
  } catch (err) {
    const translated = translateKubeError(err);
    if (translated.code === "KubeForbidden" || translated.code === "Internal") return null;
    throw translated;
  }
}

/** A label for the status line; never a secret. */
function describe(auth: KubeExecAuth): string {
  return auth.target.tool === "virtctl" ? auth.target.vm : auth.target.pod;
}
