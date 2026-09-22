import { describe, expect, it } from "vitest";

import { deriveCrumbs } from "./Breadcrumb.tsx";

/**
 * The trail is derived from the pathname alone, so it is testable without a
 * router - and worth testing, because a crumb that points at a route nobody
 * registered is a dead end that renders perfectly.
 */

function paths(pathname: string): string[] {
  return deriveCrumbs(pathname).map((crumb) => crumb.to);
}

function labels(pathname: string): string[] {
  return deriveCrumbs(pathname).map((crumb) => crumb.label);
}

describe("deriveCrumbs", () => {
  it("gives the root a single crumb", () => {
    expect(deriveCrumbs("/")).toEqual([{ label: "Overview", to: "/" }]);
  });

  it("always starts at the overview, so there is a way up", () => {
    for (const path of ["/ecs/clusters", "/s3/buckets/b", "/ec2/instances", "/settings"]) {
      expect(paths(path)[0]).toBe("/");
    }
  });

  it("names the shell routes", () => {
    expect(labels("/logs")).toEqual(["Overview", "Diagnostics"]);
    expect(labels("/settings")).toEqual(["Overview", "Settings"]);
  });

  it("walks the ECS trail down to a service", () => {
    expect(labels("/ecs/clusters/prod/services/api")).toEqual([
      "Overview",
      "ECS",
      "Clusters",
      "prod",
      "api",
    ]);
  });

  it("shortens a task id rather than showing the whole thing", () => {
    expect(labels("/ecs/clusters/prod/tasks/0123456789abcdef0123").at(-1)).toBe(
      "task 0123456789ab",
    );
  });

  it("decodes a segment that had to be encoded", () => {
    expect(labels("/s3/buckets/my%2Fodd%20bucket").at(-1)).toBe("my/odd bucket");
  });

  it("reaches the EC2 instance list", () => {
    // It used to stop at "EC2", whose own crumb pointed at a route that did
    // not exist - so the trail's last step was both missing and broken.
    expect(labels("/ec2/instances")).toEqual(["Overview", "EC2", "Instances"]);
    expect(paths("/ec2/instances")).toEqual(["/", "/ec2", "/ec2/instances"]);
  });
});
