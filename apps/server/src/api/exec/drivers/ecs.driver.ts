/**
 * An ECS Exec shell, by way of the same plugin the SSM driver uses.
 *
 * `ExecuteCommand` returns the same {session, stream, token} shape
 * `StartSession` does, and the plugin takes it the same way - the only real
 * difference is the target string, which for ECS names the cluster, task and
 * the container's *runtime* id rather than an instance.
 *
 * The pre-flight DescribeTasks is here purely for the error messages. Without
 * it, a task started without execute-command fails as a bare
 * InvalidParameterException, and the agent not being up looks identical to
 * fifteen other things. Those two cases are most of what goes wrong with ECS
 * Exec, and both have a specific fix worth naming.
 */
import { DescribeTasksCommand, ExecuteCommandCommand } from "@aws-sdk/client-ecs";
import { ecsClient } from "@faws/core";

import { ExecSessionError } from "../errors.ts";
import type { ExecDriver, ExecDriverFactory } from "../exec.service.ts";
import { spawnInteractive, type InteractiveChild } from "../pty.ts";
import { resolveSessionPlugin } from "../sessionPlugin.ts";

const SIGKILL_AFTER_MS = 2000;

function translate(err: unknown): ExecSessionError {
  const name = (err as { name?: string }).name ?? "Unknown";
  const message = err instanceof Error ? err.message : String(err);

  switch (name) {
    case "TargetNotConnectedException":
      return new ExecSessionError(
        "TargetNotConnected",
        "The task cannot reach Session Manager. Its subnet needs to reach the ssmmessages endpoints, through a NAT gateway or VPC endpoints.",
      );
    case "AccessDeniedException":
      return new ExecSessionError(
        "AccessDenied",
        `Your credentials are not allowed to call ecs:ExecuteCommand on this cluster. (${message})`,
      );
    case "ClusterNotFoundException":
      return new ExecSessionError("Internal", "That cluster does not exist in this region.");
    case "InvalidParameterException":
      return new ExecSessionError(
        "ExecuteCommandDisabled",
        `ECS rejected the exec request. On Fargate this usually means the platform version is older than 1.4.0. (${message})`,
      );
    default:
      return new ExecSessionError("Internal", message);
  }
}

export const ecsDriverFactory: ExecDriverFactory = async (auth, sink, ctx) => {
  if (auth.kind !== "ecs") {
    throw new ExecSessionError("Internal", "The ECS driver got a non-ECS handshake.");
  }

  const plugin = resolveSessionPlugin();
  if (!plugin.path) {
    throw new ExecSessionError(
      "SessionManagerPluginMissing",
      plugin.problem ?? "The Session Manager plugin could not be found.",
    );
  }

  const scope = { profile: auth.profile, region: auth.region };
  const client = ecsClient(scope);

  sink.status(`Checking ${auth.containerName} can be attached to...`);

  let described;
  try {
    described = await client.send(
      new DescribeTasksCommand({ cluster: auth.cluster, tasks: [auth.taskId] }),
      { abortSignal: ctx.signal },
    );
  } catch (err) {
    throw translate(err);
  }

  const task = described.tasks?.[0];
  if (!task) {
    throw new ExecSessionError(
      "Internal",
      `Task ${auth.taskId} is not in cluster ${auth.cluster}.`,
    );
  }
  if (task.lastStatus !== "RUNNING") {
    throw new ExecSessionError(
      "Internal",
      `That task is ${task.lastStatus ?? "not running"}; there is nothing to attach to.`,
    );
  }
  if (!task.enableExecuteCommand) {
    throw new ExecSessionError(
      "ExecuteCommandDisabled",
      "This task was started without execute-command. Redeploy the service with enableExecuteCommand and let it start a new task - the setting cannot be turned on for a task that is already running.",
    );
  }

  const container = task.containers?.find((entry) => entry.name === auth.containerName);
  if (!container?.runtimeId) {
    throw new ExecSessionError(
      "Internal",
      `Container ${auth.containerName} has no runtime id yet, so it is not ready to attach to.`,
    );
  }

  const agent = container.managedAgents?.find((entry) => entry.name === "ExecuteCommandAgent");
  if (agent && agent.lastStatus !== "RUNNING") {
    throw new ExecSessionError(
      "ExecAgentNotRunning",
      `The exec agent in this container is ${agent.lastStatus ?? "not running"}${agent.reason ? ` (${agent.reason})` : ""}. The task role usually needs ssmmessages:CreateControlChannel, CreateDataChannel, OpenControlChannel and OpenDataChannel.`,
    );
  }

  sink.status(`Starting a shell in ${auth.containerName}...`);

  let started;
  try {
    started = await client.send(
      new ExecuteCommandCommand({
        cluster: auth.cluster,
        task: auth.taskId,
        container: auth.containerName,
        command: auth.command,
        interactive: true,
      }),
      { abortSignal: ctx.signal },
    );
  } catch (err) {
    throw translate(err);
  }

  const session = started.session;
  if (!session?.sessionId || !session.streamUrl || !session.tokenValue) {
    throw new ExecSessionError("Internal", "ECS started an exec session but returned no stream.");
  }

  const target = `ecs:${auth.cluster}_${auth.taskId}_${container.runtimeId}`;
  const args = [
    JSON.stringify({
      SessionId: session.sessionId,
      StreamUrl: session.streamUrl,
      TokenValue: session.tokenValue,
    }),
    auth.region,
    "StartSession",
    auth.profile,
    JSON.stringify({ Target: target }),
    `https://ssm.${auth.region}.amazonaws.com`,
  ];

  let child: InteractiveChild;
  try {
    child = await spawnInteractive(plugin.path, args, {
      cols: auth.cols,
      rows: auth.rows,
      onDegraded: (why) => sink.status(why),
    });
  } catch (err) {
    throw new ExecSessionError(
      "SessionManagerPluginFailed",
      err instanceof Error ? err.message : String(err),
    );
  }

  let closing = false;
  child.onData((chunk) => sink.data(chunk));
  child.onExit((code) => {
    if (closing) return;
    closing = true;
    sink.exit(code, code === 0 ? null : "the exec session ended");
  });

  const driver: ExecDriver = {
    write(chunk) {
      if (!closing) child.write(chunk);
    },
    resize(cols, rows) {
      if (!closing) child.resize(cols, rows);
    },
    async close(reason) {
      if (closing) return;
      closing = true;
      // ECS exec sessions are not terminated through TerminateSession the way
      // SSM ones are; the agent tears down when the stream goes.
      ctx.log.info({ reason, sessionId: session.sessionId }, "closing ECS exec session");
      await child.kill(SIGKILL_AFTER_MS);
    },
  };

  return driver;
};
