import { defaultParseSearch } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { kubeContextRef, kubeScopeSearch, withScopedLink } from "./scope-link.ts";

/** What the router hands `validateSearch` when a row navigates to `to`. */
function landOn(to: string) {
  const [path, query = ""] = to.split("?");
  return { path, search: kubeScopeSearch.parse(defaultParseSearch(query ? `?${query}` : "")) };
}

describe("kubeContextRef", () => {
  it("navigates to the context and namespace it was recorded in", () => {
    const landed = landOn(kubeContextRef("prod-east", "payments").to);
    expect(landed.path).toBe("/kubernetes/workloads");
    expect(landed.search).toEqual({ context: "prod-east", namespace: "payments" });
  });

  it("survives a context name that looks like something other than a string", () => {
    // The router reads each search value as JSON when it can, so an unquoted
    // `123` or `true` would come back as a number or a boolean.
    expect(landOn(kubeContextRef("123", "true").to).search).toEqual({
      context: "123",
      namespace: "true",
    });
  });

  it("survives the characters a kubeconfig allows in a context name", () => {
    const name = "arn:aws:eks:us-east-1:123456789012:cluster/prod&x=1";
    expect(landOn(kubeContextRef(name, "default").to).search.context).toBe(name);
  });

  it("keys the same context in two namespaces apart", () => {
    expect(kubeContextRef("prod", "a").id).not.toBe(kubeContextRef("prod", "b").id);
  });
});

describe("kubeScopeSearch", () => {
  it("reads a URL without a scope as no scope", () => {
    expect(kubeScopeSearch.parse({})).toEqual({});
  });

  it("drops a scope value it cannot read rather than refusing the page", () => {
    expect(kubeScopeSearch.parse({ context: 7, namespace: ["x"] })).toEqual({});
  });
});

describe("withScopedLink", () => {
  const at = "2026-01-01T00:00:00.000Z";

  it("points an entry recorded with a bare link at its own context", () => {
    const stale = { ...kubeContextRef("prod", "payments"), to: "/kubernetes/workloads", at };
    const landed = landOn(withScopedLink(stale).to);
    expect(landed.path).toBe("/kubernetes/workloads");
    expect(landed.search).toEqual({ context: "prod", namespace: "payments" });
  });

  it("leaves an entry that already carries its scope alone", () => {
    const current = { ...kubeContextRef("prod", "payments"), at };
    expect(withScopedLink(current)).toBe(current);
  });

  it("leaves every other kind alone", () => {
    const bucket = {
      kind: "s3-bucket" as const,
      id: "arn:aws:s3:::logs",
      label: "logs",
      detail: "",
      scope: { profile: "default", region: "us-east-1", connectionId: "" },
      to: "/s3/buckets/logs",
      at,
    };
    expect(withScopedLink(bucket)).toBe(bucket);
  });
});
