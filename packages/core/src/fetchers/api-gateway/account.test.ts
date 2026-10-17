import { describe, expect, it } from "vitest";

import { apiGatewayAccount } from "./account.ts";

describe("apiGatewayAccount", () => {
  it("reads the CloudWatch role", () => {
    expect(
      apiGatewayAccount({ cloudwatchRoleArn: "arn:aws:iam::123456789012:role/apigw-logs" }),
    ).toEqual({ cloudwatchRoleArn: "arn:aws:iam::123456789012:role/apigw-logs" });
  });

  it("treats an absent or empty role as none", () => {
    expect(apiGatewayAccount({})).toEqual({ cloudwatchRoleArn: null });
    expect(apiGatewayAccount({ cloudwatchRoleArn: "" })).toEqual({ cloudwatchRoleArn: null });
  });
});
