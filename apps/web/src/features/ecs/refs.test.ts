import { resourceKey, resourceRefSchema } from "@faws/contracts";
import { describe, expect, it } from "vitest";

import {
  clusterRef,
  containerInstanceRef,
  serviceRef,
  taskDefinitionRef,
  taskRef,
} from "./refs.ts";

const scope = { profile: "prod", region: "eu-west-1" };

describe("ECS refs", () => {
  it("keeps the cluster and service ids that existing pins are stored under", () => {
    expect(clusterRef("main", scope).id).toBe("main");
    expect(serviceRef("main", "api", scope).id).toBe("main/api");
  });

  it("encodes names into the link", () => {
    expect(clusterRef("a b", scope).to).toBe("/ecs/clusters/a%20b");
    expect(serviceRef("main", "x/y", scope).to).toBe("/ecs/clusters/main/services/x%2Fy");
    expect(taskRef("main", "abc123", null, scope).to).toBe("/ecs/clusters/main/tasks/abc123");
    expect(taskDefinitionRef("web app", scope).to).toBe("/ecs/task-definitions?family=web%20app");
  });

  it("gives a task the same key from its page and from a row", () => {
    // the page knows the service only once the task loads, the row always does
    const fromPage = taskRef("main", "abc123", undefined, scope);
    const fromRow = taskRef("main", "abc123", "api", scope);
    expect(resourceKey(fromPage)).toBe(resourceKey(fromRow));
    expect(fromRow.detail).toBe("main · api");
  });

  it("points a container instance at its cluster's EC2 tab, filtered to it", () => {
    const ref = containerInstanceRef("main", { id: "c0ffee", ec2InstanceId: "i-123" }, scope);
    expect(ref.label).toBe("i-123");
    expect(ref.to).toBe("/ecs/clusters/main?tab=instances&q=i-123");

    const bare = containerInstanceRef("main", { id: "c0ffee", ec2InstanceId: null }, scope);
    expect(bare.to).toBe("/ecs/clusters/main?tab=instances&q=c0ffee");
    expect(resourceKey(bare)).toBe(resourceKey(ref));
  });

  it("builds refs the settings file will accept", () => {
    const refs = [
      clusterRef("main", scope),
      serviceRef("main", "api", scope),
      taskRef("main", "abc123", "api", scope),
      taskDefinitionRef("web", scope),
      containerInstanceRef("main", { id: "c0ffee", ec2InstanceId: "i-123" }, scope),
    ];
    for (const ref of refs) expect(resourceRefSchema.parse(ref)).toEqual(ref);
  });
});
