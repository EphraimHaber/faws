import { describe, expect, it } from "vitest";

import { restApiResource } from "./resources.ts";

describe("restApiResource", () => {
  it("reads a method and its integration", () => {
    const resource = restApiResource({
      id: "r1",
      parentId: "root",
      path: "/orders",
      pathPart: "orders",
      resourceMethods: {
        GET: {
          httpMethod: "GET",
          authorizationType: "CUSTOM",
          authorizerId: "auth1",
          apiKeyRequired: true,
          operationName: "ListOrders",
          requestParameters: { "method.request.querystring.page": false },
          methodIntegration: {
            type: "AWS_PROXY",
            httpMethod: "POST",
            uri: "arn:aws:apigateway:eu-west-1:lambda:path/2015-03-31/functions/arn/invocations",
            connectionType: "INTERNET",
            timeoutInMillis: 29000,
            passthroughBehavior: "WHEN_NO_MATCH",
            cacheKeyParameters: ["method.request.querystring.page"],
          },
        },
      },
    });

    expect(resource).toEqual({
      id: "r1",
      parentId: "root",
      path: "/orders",
      pathPart: "orders",
      methods: [
        {
          httpMethod: "GET",
          authorizationType: "CUSTOM",
          authorizerId: "auth1",
          apiKeyRequired: true,
          operationName: "ListOrders",
          requestParameters: { "method.request.querystring.page": false },
          integration: {
            type: "AWS_PROXY",
            httpMethod: "POST",
            uri: "arn:aws:apigateway:eu-west-1:lambda:path/2015-03-31/functions/arn/invocations",
            connectionType: "INTERNET",
            connectionId: null,
            credentials: null,
            timeoutMs: 29000,
            passthroughBehavior: "WHEN_NO_MATCH",
            cacheKeyParameters: ["method.request.querystring.page"],
          },
        },
      ],
    });
  });

  it("puts methods in reading order rather than the alphabet", () => {
    const resource = restApiResource({
      id: "r1",
      path: "/",
      resourceMethods: { OPTIONS: {}, DELETE: {}, POST: {}, GET: {}, ANY: {} },
    });
    expect(resource?.methods.map((method) => method.httpMethod)).toEqual([
      "ANY",
      "GET",
      "POST",
      "DELETE",
      "OPTIONS",
    ]);
  });

  it("gives a method without an integration none, and fills in the flags", () => {
    const method = restApiResource({ id: "r1", path: "/", resourceMethods: { GET: {} } })
      ?.methods[0];
    expect(method).toMatchObject({
      httpMethod: "GET",
      apiKeyRequired: false,
      authorizerId: null,
      requestParameters: {},
      integration: null,
    });
  });

  it("reads the root as having no parent and skips a resource without an id", () => {
    expect(restApiResource({ id: "root", path: "/" })?.parentId).toBeNull();
    expect(restApiResource({ path: "/ghost" })).toBeNull();
  });
});
