/**
 * What each ECS thing is remembered as, in the pinned and recent lists.
 *
 * One builder per kind, so a detail page's header and a list row pinning the
 * same thing produce the same `resourceKey` and toggle together.
 *
 * Ids are natural keys (names, `cluster/name`) rather than ARNs: a row and the
 * route both have them before anything loads, and the cluster and service ids
 * are already stored in people's settings, so changing their shape would drop
 * their pins.
 */
import type { EcsContainerInstance, ResourceRef } from "@faws/contracts";

interface AwsScope {
  readonly profile: string;
  readonly region: string;
}

function scoped(scope: AwsScope): ResourceRef["scope"] {
  return { profile: scope.profile, region: scope.region, connectionId: "" };
}

const enc = encodeURIComponent;

export function clusterRef(cluster: string, scope: AwsScope): ResourceRef {
  return {
    kind: "ecs-cluster",
    id: cluster,
    label: cluster,
    detail: "cluster",
    scope: scoped(scope),
    to: `/ecs/clusters/${enc(cluster)}`,
  };
}

/** The cluster is the detail line because a service name alone is ambiguous across clusters. */
export function serviceRef(cluster: string, service: string, scope: AwsScope): ResourceRef {
  return {
    kind: "ecs-service",
    id: `${cluster}/${service}`,
    label: service,
    detail: cluster,
    scope: scoped(scope),
    to: `/ecs/clusters/${enc(cluster)}/services/${enc(service)}`,
  };
}

export function taskRef(
  cluster: string,
  taskId: string,
  serviceName: string | null | undefined,
  scope: AwsScope,
): ResourceRef {
  return {
    kind: "ecs-task",
    id: `${cluster}/${taskId}`,
    label: taskId,
    detail: serviceName ? `${cluster} · ${serviceName}` : cluster,
    scope: scoped(scope),
    to: `/ecs/clusters/${enc(cluster)}/tasks/${enc(taskId)}`,
  };
}

/** The family, not a revision: it opens on whichever revision is newest. */
export function taskDefinitionRef(family: string, scope: AwsScope): ResourceRef {
  return {
    kind: "ecs-task-definition",
    id: family,
    label: family,
    detail: "task definition",
    scope: scoped(scope),
    to: `/ecs/task-definitions?family=${enc(family)}`,
  };
}

/** There is no page per instance, so it opens the cluster's EC2 tab filtered to it. */
export function containerInstanceRef(
  cluster: string,
  row: Pick<EcsContainerInstance, "id" | "ec2InstanceId">,
  scope: AwsScope,
): ResourceRef {
  const name = row.ec2InstanceId ?? row.id;
  return {
    kind: "ecs-container-instance",
    id: `${cluster}/${row.id}`,
    label: name,
    detail: cluster,
    scope: scoped(scope),
    to: `/ecs/clusters/${enc(cluster)}?tab=instances&q=${enc(name)}`,
  };
}
