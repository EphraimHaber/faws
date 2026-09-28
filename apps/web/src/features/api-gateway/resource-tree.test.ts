import type { RestApiMethod, RestApiResource } from "@faws/contracts";
import { describe, expect, it } from "vitest";

import { buildResourceTree, resourceMatches, resourceRows } from "./resource-tree.ts";

function method(httpMethod: string, extra: Partial<RestApiMethod> = {}): RestApiMethod {
  return {
    httpMethod,
    authorizationType: "NONE",
    authorizerId: null,
    apiKeyRequired: false,
    operationName: null,
    requestParameters: {},
    integration: null,
    ...extra,
  };
}

function resource(
  id: string,
  parentId: string | null,
  path: string,
  methods: RestApiMethod[] = [],
): RestApiResource {
  return { id, parentId, path, pathPart: path.split("/").pop() || null, methods };
}

const flat: RestApiResource[] = [
  resource("orderId", "orders", "/orders/{orderId}", [method("GET"), method("DELETE")]),
  resource("root", null, "/"),
  resource("users", "root", "/users", [method("GET", { operationName: "ListUsers" })]),
  resource("orders", "root", "/orders", [
    method("POST", {
      integration: {
        type: "AWS_PROXY",
        httpMethod: "POST",
        uri: "arn:aws:apigateway:eu-west-1:lambda:path/functions/create-order/invocations",
        connectionType: "INTERNET",
        connectionId: null,
        credentials: null,
        timeoutMs: 29000,
        passthroughBehavior: null,
        cacheKeyParameters: [],
      },
    }),
  ]),
  resource("items", "orderId", "/orders/{orderId}/items", [method("GET")]),
  resource("export", "orders", "/orders/export"),
];

function paths(rows: ReturnType<typeof resourceRows>): string[] {
  return rows.map((row) => `${"  ".repeat(row.depth)}${row.resource.path}`);
}

describe("buildResourceTree", () => {
  it("nests resources under their parents, siblings by path", () => {
    expect(paths(resourceRows(buildResourceTree(flat), ""))).toEqual([
      "/",
      "  /orders",
      "    /orders/export",
      "    /orders/{orderId}",
      "      /orders/{orderId}/items",
      "  /users",
    ]);
  });

  it("keeps a resource whose parent was not listed, as a root", () => {
    const tree = buildResourceTree([resource("items", "orderId", "/orders/{orderId}/items")]);
    expect(tree.map((node) => node.resource.id)).toEqual(["items"]);
  });

  it("does not loop on a resource that names itself as its parent", () => {
    const tree = buildResourceTree([resource("odd", "odd", "/odd")]);
    expect(tree.map((node) => node.resource.id)).toEqual(["odd"]);
  });

  it("builds nothing from nothing", () => {
    expect(buildResourceTree([])).toEqual([]);
  });
});

describe("resourceMatches", () => {
  const orders = flat.find((entry) => entry.id === "orders") as RestApiResource;
  const users = flat.find((entry) => entry.id === "users") as RestApiResource;

  it("matches the path, ignoring case", () => {
    expect(resourceMatches(orders, "ORDERS")).toBe(true);
  });

  it("matches the backend a method calls", () => {
    expect(resourceMatches(orders, "create-order")).toBe(true);
  });

  it("matches an operation name", () => {
    expect(resourceMatches(users, "listusers")).toBe(true);
  });

  it("matches a method by its whole name only", () => {
    expect(resourceMatches(users, "get")).toBe(true);
    expect(resourceMatches(users, "ge")).toBe(false);
  });

  it("matches everything with an empty filter", () => {
    expect(resourceMatches(users, "  ")).toBe(true);
  });
});

describe("resourceRows", () => {
  const tree = buildResourceTree(flat);

  it("keeps the paths leading to a match, marked as not matching themselves", () => {
    const rows = resourceRows(tree, "items");
    expect(paths(rows)).toEqual([
      "/",
      "  /orders",
      "    /orders/{orderId}",
      "      /orders/{orderId}/items",
    ]);
    expect(rows.map((row) => row.matched)).toEqual([false, false, false, true]);
  });

  it("shows a matched resource without the children that do not match", () => {
    expect(paths(resourceRows(tree, "/users"))).toEqual(["/", "  /users"]);
  });

  it("shows nothing when nothing matches", () => {
    expect(resourceRows(tree, "nowhere")).toEqual([]);
  });
});
