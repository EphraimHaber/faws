import type { RestApiMethod, RestApiResource } from "@faws/contracts";
import { describe, expect, it } from "vitest";

import { lambdaFromUri, methodsByAuthorizer } from "./authorizers.ts";

const FUNCTION = "arn:aws:lambda:eu-west-1:123456789012:function:check";

function uri(functionArn: string): string {
  return `arn:aws:apigateway:eu-west-1:lambda:path/2015-03-31/functions/${functionArn}/invocations`;
}

describe("lambdaFromUri", () => {
  it("reads the function an invocation URI names", () => {
    expect(lambdaFromUri(uri(FUNCTION))).toEqual({
      arn: FUNCTION,
      region: "eu-west-1",
      name: "check",
      qualifier: null,
    });
  });

  it("keeps an alias or a stage variable as the qualifier", () => {
    expect(lambdaFromUri(uri(`${FUNCTION}:live`))).toMatchObject({
      arn: `${FUNCTION}:live`,
      name: "check",
      qualifier: "live",
    });
    expect(lambdaFromUri(uri(`${FUNCTION}:\${stageVariables.alias}`))?.qualifier).toBe(
      "${stageVariables.alias}",
    );
  });

  it("reads other partitions", () => {
    const arn = "arn:aws-cn:lambda:cn-north-1:123456789012:function:check";
    expect(
      lambdaFromUri(
        `arn:aws-cn:apigateway:cn-north-1:lambda:path/2015-03-31/functions/${arn}/invocations`,
      ),
    ).toMatchObject({ arn, region: "cn-north-1", name: "check" });
  });

  it("returns null for a URI that invokes something else", () => {
    expect(lambdaFromUri("https://example.com/auth")).toBeNull();
    expect(lambdaFromUri("arn:aws:apigateway:eu-west-1:dynamodb:action/GetItem")).toBeNull();
  });
});

function method(httpMethod: string, authorizerId: string | null): RestApiMethod {
  return {
    httpMethod,
    authorizationType: authorizerId ? "CUSTOM" : "NONE",
    authorizerId,
    apiKeyRequired: false,
    operationName: null,
    requestParameters: {},
    integration: null,
  };
}

function resource(id: string, path: string, methods: RestApiMethod[]): RestApiResource {
  return { id, parentId: null, path, pathPart: path.split("/").at(-1) ?? null, methods };
}

describe("methodsByAuthorizer", () => {
  it("groups guarded methods by authorizer, in path order", () => {
    const byAuthorizer = methodsByAuthorizer([
      resource("r2", "/orders", [method("GET", "a1"), method("POST", "a2")]),
      resource("r1", "/admin", [method("DELETE", "a1"), method("GET", null)]),
    ]);
    expect(byAuthorizer.get("a1")).toEqual([
      { resourceId: "r1", path: "/admin", httpMethod: "DELETE" },
      { resourceId: "r2", path: "/orders", httpMethod: "GET" },
    ]);
    expect(byAuthorizer.get("a2")).toEqual([
      { resourceId: "r2", path: "/orders", httpMethod: "POST" },
    ]);
    expect(byAuthorizer.size).toBe(2);
  });
});
