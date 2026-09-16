import type { EcsService, EcsTask, ServiceDeploymentState } from "@faws/contracts";

import type { StatusTone } from "~/components/ui/status-dot";

/** Deployment state -> the dot tone and label shown in every service row. */
export function serviceTone(state: ServiceDeploymentState): {
  tone: StatusTone;
  label: string;
  pulse: boolean;
} {
  switch (state) {
    case "steady":
      return { tone: "success", label: "steady", pulse: false };
    case "deploying":
      return { tone: "info", label: "deploying", pulse: true };
    case "degraded":
      return { tone: "danger", label: "degraded", pulse: false };
    case "draining":
      return { tone: "warning", label: "draining", pulse: true };
    default:
      return { tone: "neutral", label: "unknown", pulse: false };
  }
}

export function taskTone(task: EcsTask): { tone: StatusTone; pulse: boolean } {
  if (task.lastStatus === "RUNNING") {
    if (task.health === "UNHEALTHY") return { tone: "danger", pulse: false };
    if (task.health === "UNKNOWN") return { tone: "info", pulse: false };
    return { tone: "success", pulse: false };
  }
  if (task.lastStatus === "STOPPED") {
    return { tone: task.stoppedReason ? "danger" : "neutral", pulse: false };
  }
  // PROVISIONING / PENDING / ACTIVATING / DEACTIVATING: in motion.
  return { tone: "warning", pulse: true };
}

/** 0..1 for the desired-vs-running meter drawn behind service counts. */
export function serviceFill(service: EcsService): number {
  if (service.desiredCount === 0) return 0;
  return Math.min(1, service.runningCount / service.desiredCount);
}
