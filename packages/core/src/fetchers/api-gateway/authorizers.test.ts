import { describe, expect, it } from "vitest";

import { restApiAuthorizer } from "./authorizers.ts";

describe("restApiAuthorizer", () => {
  it("reads a Lambda token authorizer", () => {
    expect(
      restApiAuthorizer({
        id: "auth1",
        name: "jwt",
        type: "TOKEN",
        identitySource: "method.request.header.Authorization",
        identityValidationExpression: "^Bearer .+$",
        authorizerUri:
          "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:check/invocations",
        authorizerCredentials: "arn:aws:iam::123456789012:role/invoke",
        authorizerResultTtlInSeconds: 300,
      }),
    ).toEqual({
      id: "auth1",
      name: "jwt",
      type: "TOKEN",
      identitySource: "method.request.header.Authorization",
      identityValidationExpression: "^Bearer .+$",
      authorizerUri:
        "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:check/invocations",
      credentials: "arn:aws:iam::123456789012:role/invoke",
      resultTtlSeconds: 300,
      providerArns: [],
    });
  });

  it("reads a Cognito authorizer's user pools and keeps a zero ttl", () => {
    const authorizer = restApiAuthorizer({
      id: "auth2",
      name: "users",
      type: "COGNITO_USER_POOLS",
      providerARNs: ["arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_abc"],
      authorizerResultTtlInSeconds: 0,
    });
    expect(authorizer?.providerArns).toEqual([
      "arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_abc",
    ]);
    expect(authorizer?.resultTtlSeconds).toBe(0);
    expect(authorizer?.authorizerUri).toBeNull();
  });

  it("names an unnamed authorizer by its id, and drops one without an id", () => {
    expect(restApiAuthorizer({ id: "auth3" })?.name).toBe("auth3");
    expect(restApiAuthorizer({ name: "orphan" })).toBeNull();
  });
});
