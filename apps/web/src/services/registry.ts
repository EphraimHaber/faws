import {
  Boxes,
  Container,
  Database,
  FileJson,
  FunctionSquare,
  Gauge,
  HardDrive,
  Inbox,
  Layers,
  Rocket,
  ScrollText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The AWS services faws knows about.
 *
 * This is the seam the app is organised around: the sidebar, the command
 * palette and the breadcrumb trail all read it, so adding CloudWatch or S3
 * means adding an entry and a feature folder — not touching the shell.
 *
 * `planned` entries are listed deliberately rather than hidden: knowing what a
 * tool doesn't do yet is worth a disabled row.
 */
export interface AwsServiceSection {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** Route for this section; absent while planned. */
  readonly to?: string;
}

export interface AwsServiceDefinition {
  readonly id: string;
  /** Short name as AWS writes it. */
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly status: "available" | "planned";
  /** Root route; every section lives under it. */
  readonly basePath: string;
  readonly sections: ReadonlyArray<AwsServiceSection>;
}

/**
 * Typed as non-empty so callers that need "some service" — a default
 * selection, a fallback for an unrecognised id — can take the first entry
 * without a runtime guard for a list that is never empty.
 */
export const AWS_SERVICES: readonly [AwsServiceDefinition, ...AwsServiceDefinition[]] = [
  {
    id: "ecs",
    label: "ECS",
    description: "Clusters, services, tasks and task definitions",
    icon: Container,
    status: "available",
    basePath: "/ecs",
    sections: [
      { id: "clusters", label: "Clusters", icon: Layers, to: "/ecs/clusters" },
      { id: "deployments", label: "Recently deployed", icon: Rocket, to: "/ecs/deployments" },
      {
        id: "task-definitions",
        label: "Task definitions",
        icon: FileJson,
        to: "/ecs/task-definitions",
      },
    ],
  },
  {
    id: "cloudwatch",
    label: "CloudWatch",
    description: "Log groups and metrics beyond the ones ECS surfaces",
    icon: Gauge,
    status: "planned",
    basePath: "/cloudwatch",
    sections: [
      { id: "logs", label: "Log groups", icon: ScrollText },
      { id: "metrics", label: "Metrics", icon: Gauge },
    ],
  },
  {
    id: "s3",
    label: "S3",
    description: "Buckets, objects and what they hold",
    icon: HardDrive,
    status: "available",
    basePath: "/s3",
    sections: [{ id: "buckets", label: "Buckets", icon: Database, to: "/s3/buckets" }],
  },
  {
    id: "lambda",
    label: "Lambda",
    description: "Functions, versions and invocations",
    icon: FunctionSquare,
    status: "planned",
    basePath: "/lambda",
    sections: [{ id: "functions", label: "Functions", icon: Boxes }],
  },
  {
    id: "sqs",
    label: "SQS",
    description: "Queues, depth and redrive",
    icon: Inbox,
    status: "planned",
    basePath: "/sqs",
    sections: [{ id: "queues", label: "Queues", icon: Inbox }],
  },
];

export function findService(id: string): AwsServiceDefinition | undefined {
  return AWS_SERVICES.find((service) => service.id === id);
}

/** What a caller lands on when it has no id of its own to offer. */
export const DEFAULT_SERVICE: AwsServiceDefinition =
  AWS_SERVICES.find((service) => service.status === "available") ?? AWS_SERVICES[0];

/**
 * Turns whatever a URL carries into a service that exists.
 *
 * Shared and bookmarked links outlive the registry, so an id that was never
 * valid — or stopped being — resolves to the default instead of leaving the
 * caller with nothing to render.
 */
export function resolveService(value: unknown): AwsServiceDefinition {
  return (typeof value === "string" ? findService(value) : undefined) ?? DEFAULT_SERVICE;
}

/** The service a pathname belongs to, for the sidebar's active state. */
export function serviceForPath(pathname: string): AwsServiceDefinition | undefined {
  return AWS_SERVICES.find(
    (service) => pathname === service.basePath || pathname.startsWith(`${service.basePath}/`),
  );
}
