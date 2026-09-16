/**
 * ECS ARNs end in the resource path, e.g.
 *   arn:aws:ecs:eu-west-1:1234:task/my-cluster/9f0e...
 * The UI shows the last segment nearly everywhere, so this is the one
 * helper both the server fetchers and the renderer share.
 */
export function arnTail(arn: string | undefined | null): string {
  if (!arn) return "-";
  const slash = arn.lastIndexOf("/");
  return slash === -1 ? arn : arn.slice(slash + 1);
}

/** "family:7" out of a task-definition ARN or an already-short string. */
export function taskDefinitionLabel(taskDefinition: string | undefined | null): string {
  if (!taskDefinition) return "-";
  return arnTail(taskDefinition);
}

export function splitTaskDefinition(taskDefinition: string): {
  family: string;
  revision: number;
} {
  const label = taskDefinitionLabel(taskDefinition);
  const colon = label.lastIndexOf(":");
  if (colon === -1) return { family: label, revision: 0 };
  const revision = Number(label.slice(colon + 1));
  return {
    family: label.slice(0, colon),
    revision: Number.isInteger(revision) ? revision : 0,
  };
}

export function regionFromArn(arn: string | undefined | null): string | null {
  if (!arn) return null;
  const parts = arn.split(":");
  return parts.length > 3 && parts[3] ? parts[3] : null;
}
