import { defineProvider } from "@faws/kit";

/**
 * AWS, through the profiles in `~/.aws`.
 *
 * `cluster` means an ECS cluster here and everywhere else in the app; the
 * Kubernetes provider never uses the word.
 */
export const awsManifest = defineProvider({
  id: "aws",
  label: "AWS",
  description: "Accounts and regions from your AWS profiles",
  icon: "cloud",
  order: 10,
  defaultEnabled: true,
  capabilities: ["objectStorage", "logs", "metrics", "terminal", "identity"],
  runtimeDefaults: {},
  services: [
    {
      id: "ecs",
      label: "ECS",
      description: "Clusters, services, tasks and task definitions",
      icon: "container",
      status: "available",
      basePath: "/ecs",
      sections: [
        { id: "clusters", label: "Clusters", icon: "layers", to: "/ecs/clusters" },
        { id: "deployments", label: "Recently deployed", icon: "rocket", to: "/ecs/deployments" },
        {
          id: "task-definitions",
          label: "Task definitions",
          icon: "file-json",
          to: "/ecs/task-definitions",
        },
      ],
    },
    {
      id: "cloudwatch",
      label: "CloudWatch",
      description: "Log groups and metrics beyond the ones ECS surfaces",
      icon: "gauge",
      status: "available",
      basePath: "/cloudwatch",
      sections: [
        {
          id: "log-groups",
          label: "Log groups",
          icon: "scroll-text",
          to: "/cloudwatch/log-groups",
        },
        { id: "metrics", label: "Metrics", icon: "gauge", to: "/cloudwatch/metrics" },
      ],
    },
    {
      id: "api-gateway",
      label: "API Gateway",
      description: "REST APIs, custom domains and usage plans in this region, read only",
      icon: "waypoints",
      status: "available",
      basePath: "/api-gateway",
      sections: [
        { id: "rest-apis", label: "REST APIs", icon: "network", to: "/api-gateway/rest-apis" },
        { id: "domains", label: "Custom domains", icon: "globe", to: "/api-gateway/domains" },
        {
          id: "usage-plans",
          label: "Usage plans",
          icon: "key-round",
          to: "/api-gateway/usage-plans",
        },
      ],
    },
    {
      id: "s3",
      label: "S3",
      description: "Buckets, objects and what they hold",
      icon: "hard-drive",
      status: "available",
      basePath: "/s3",
      sections: [{ id: "buckets", label: "Buckets", icon: "database", to: "/s3/buckets" }],
    },
    {
      id: "ec2",
      label: "EC2",
      description: "Instances, and shells onto them",
      icon: "server",
      status: "available",
      basePath: "/ec2",
      sections: [{ id: "instances", label: "Instances", icon: "server", to: "/ec2/instances" }],
    },
    {
      id: "lambda",
      label: "Lambda",
      description: "Functions, versions and invocations",
      icon: "function-square",
      status: "planned",
      basePath: "/lambda",
      sections: [{ id: "functions", label: "Functions", icon: "boxes" }],
    },
    {
      id: "sqs",
      label: "SQS",
      description: "Queues, depth and redrive",
      icon: "inbox",
      status: "planned",
      basePath: "/sqs",
      sections: [{ id: "queues", label: "Queues", icon: "inbox" }],
    },
  ],
});
