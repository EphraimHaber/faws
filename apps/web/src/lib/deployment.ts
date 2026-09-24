import type { EcsDeployment, EcsService, EcsServiceEvent } from "@faws/contracts";

import type { StatusTone } from "~/components/ui/status-dot";

/**
 * ECS service events are prose with a stable grammar. Classifying them turns a
 * wall of near-identical sentences into a readable narrative: which lines are
 * the rollout progressing, which are the load balancer, and which are the
 * reason it is stuck.
 */
export type EventKind =
  | "start"
  | "stop"
  | "drain"
  | "register"
  | "deregister"
  | "steady"
  | "unhealthy"
  | "placement"
  | "failed"
  | "rollback"
  | "scale"
  | "other";

export interface ClassifiedEvent extends EcsServiceEvent {
  readonly kind: EventKind;
  readonly tone: StatusTone;
  /** The deployment this line belongs to, when ECS named one. */
  readonly deploymentId: string | null;
  /** Short label for the timeline gutter. */
  readonly label: string;
}

const PATTERNS: ReadonlyArray<{
  readonly test: RegExp;
  readonly kind: EventKind;
  readonly tone: StatusTone;
  readonly label: string;
}> = [
  {
    test: /circuit breaker|rolling back|roll back/i,
    kind: "rollback",
    tone: "danger",
    label: "rollback",
  },
  {
    test: /deployment failed|failed to start|tasks failed/i,
    kind: "failed",
    tone: "danger",
    label: "failed",
  },
  {
    test: /unable to (place|consistently place)|insufficient|no container instance/i,
    kind: "placement",
    tone: "danger",
    label: "placement",
  },
  {
    test: /is unhealthy|health checks failed|failing health/i,
    kind: "unhealthy",
    tone: "danger",
    label: "unhealthy",
  },
  {
    test: /has reached a steady state|deployment completed/i,
    kind: "steady",
    tone: "success",
    label: "steady",
  },
  { test: /has started \d+ task/i, kind: "start", tone: "info", label: "start" },
  { test: /has stopped \d+ running task/i, kind: "stop", tone: "warning", label: "stop" },
  { test: /begun draining|draining connections/i, kind: "drain", tone: "warning", label: "drain" },
  { test: /\bderegistered \d+ target/i, kind: "deregister", tone: "warning", label: "deregister" },
  { test: /\bregistered \d+ target/i, kind: "register", tone: "success", label: "register" },
  { test: /desired count|updated .* desired/i, kind: "scale", tone: "info", label: "scale" },
];

export function classifyEvent(event: EcsServiceEvent): ClassifiedEvent {
  const match = PATTERNS.find((pattern) => pattern.test.test(event.message));
  return {
    ...event,
    kind: match?.kind ?? "other",
    tone: match?.tone ?? "neutral",
    label: match?.label ?? "event",
    deploymentId: deploymentIdFromEvent(event.message),
  };
}

/** ECS tags lines with `(deployment ecs-svc/123…)` when one is responsible. */
export function deploymentIdFromEvent(message: string): string | null {
  return /\(deployment (ecs-svc\/\d+)\)/.exec(message)?.[1] ?? null;
}

/** How long a finished rollout stays on screen, in green, before it is put away. */
export const DEPLOYED_LINGER_MS = 2 * 60_000;

// a rollout that took longer than this to settle is a scale of an old deployment, which also bumps updatedAt
const MAX_ROLLOUT_MS = 60 * 60_000;

/**
 * The moment a service's finished rollout should stop being shown, or null
 * when it has none worth showing.
 */
export function deployedUntil(service: EcsService): number | null {
  if (service.deploymentState !== "steady" || !service.steadySince || !service.lastDeploymentAt) {
    return null;
  }
  const settled = Date.parse(service.steadySince);
  const started = Date.parse(service.lastDeploymentAt);
  if (Number.isNaN(settled) || Number.isNaN(started)) return null;
  if (settled - started > MAX_ROLLOUT_MS) return null;
  return settled + DEPLOYED_LINGER_MS;
}

export type RolloutStepState = "done" | "active" | "pending" | "failed";

export interface RolloutStep {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly state: RolloutStepState;
}

export interface RolloutView {
  readonly primary: EcsDeployment;
  /** Deployments being replaced, still holding running tasks. */
  readonly superseded: ReadonlyArray<EcsDeployment>;
  readonly steps: ReadonlyArray<RolloutStep>;
  readonly percent: number;
  readonly rollingBack: boolean;
  readonly failing: boolean;
  /** Every step is done: ECS reports the rollout complete and the old revision is gone. */
  readonly settled: boolean;
  /** AWS's own explanation, when it gave one. */
  readonly reason: string | null;
}

/**
 * Derives the rollout as a sequence of steps.
 *
 * ECS exposes a rollout as counters spread over two or more deployment records
 * plus a stream of prose. What an operator wants is the shape of the thing:
 * how far along, what it is doing right now, and whether it is about to undo
 * itself.
 */
export function rolloutView(
  service: EcsService,
  deployments: ReadonlyArray<EcsDeployment>,
  events: ReadonlyArray<ClassifiedEvent>,
): RolloutView | null {
  const primary = deployments.find((d) => d.status === "PRIMARY");
  if (!primary) return null;

  const superseded = deployments.filter((d) => d.id !== primary.id && d.runningCount > 0);
  const target = Math.max(primary.desiredCount, 1);
  const percent = Math.min(100, Math.round((primary.runningCount / target) * 100));

  const rollingBack =
    primary.rolloutState === "FAILED" ||
    /rolling back|circuit breaker/i.test(primary.rolloutStateReason ?? "") ||
    events.slice(0, 12).some((event) => event.kind === "rollback");
  const failing = primary.failedTasks > 0 || rollingBack;

  const startedAll = primary.runningCount + primary.pendingCount >= primary.desiredCount;
  const allRunning = primary.runningCount >= primary.desiredCount;
  const registered = events.some(
    (event) => event.kind === "register" && event.deploymentId === primary.id,
  );
  const drained = superseded.length === 0;
  const steady = primary.rolloutState === "COMPLETED" && allRunning && drained;
  const usesLoadBalancer = service.loadBalancers.length > 0;

  const steps: RolloutStep[] = [
    {
      id: "start",
      title: "Starting new tasks",
      detail: `${primary.runningCount + primary.pendingCount} of ${primary.desiredCount} placed · revision ${primary.taskDefinition}`,
      state: failing && !startedAll ? "failed" : startedAll ? "done" : "active",
    },
    {
      id: "healthy",
      title: usesLoadBalancer ? "Passing health checks" : "Reaching running state",
      detail: usesLoadBalancer
        ? registered
          ? "targets registered with the load balancer"
          : "waiting for targets to pass health checks"
        : `${primary.runningCount} of ${primary.desiredCount} running`,
      state:
        failing && startedAll && !allRunning
          ? "failed"
          : allRunning
            ? "done"
            : startedAll
              ? "active"
              : "pending",
    },
    {
      id: "drain",
      title: "Draining the previous revision",
      detail: drained
        ? "no tasks left on the old revision"
        : `${superseded.reduce((sum, d) => sum + d.runningCount, 0)} still running on ${superseded.map((d) => d.taskDefinition).join(", ")}`,
      state: drained ? "done" : allRunning ? "active" : "pending",
    },
    {
      id: "steady",
      title: "Steady state",
      detail: steady ? "ECS reports the service is stable" : "not yet reported",
      state: steady ? "done" : "pending",
    },
  ];

  if (rollingBack) {
    steps.push({
      id: "rollback",
      title: "Rolling back",
      detail:
        primary.rolloutStateReason ??
        "The circuit breaker tripped; ECS is restoring the previous task definition.",
      state: "failed",
    });
  }

  return {
    primary,
    superseded,
    steps,
    percent,
    rollingBack,
    failing,
    settled: steady && !rollingBack,
    reason: primary.rolloutStateReason,
  };
}

/**
 * How close the failures are to tripping the breaker.
 *
 * AWS's threshold is `max(3, min(200, desiredCount))` consecutive failures
 * before rollback; the exact number isn't exposed, so this is the documented
 * formula rather than a reported value.
 */
export function circuitBreakerThreshold(desiredCount: number): number {
  return Math.max(3, Math.min(200, desiredCount));
}
