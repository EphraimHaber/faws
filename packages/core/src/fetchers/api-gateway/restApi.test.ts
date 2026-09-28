import { describe, expect, it } from "vitest";

import { restApiDetail, restApiPolicyText } from "./restApi.ts";

const policy = {
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: "*",
      Action: "execute-api:Invoke",
      Resource: "arn:aws:execute-api:eu-west-1:123456789012:a1b2c3d4e5/*",
    },
  ],
};

describe("restApiPolicyText", () => {
  it("unescapes the policy API Gateway hands back", () => {
    const escaped = JSON.stringify(policy).replace(/"/g, '\\"').replace(/\//g, "\\/");
    expect(JSON.parse(restApiPolicyText(escaped) ?? "")).toEqual(policy);
  });

  it("keeps a policy that already parses", () => {
    const text = JSON.stringify(policy);
    expect(restApiPolicyText(text)).toBe(text);
  });

  it("returns text that parses neither way as it came", () => {
    expect(restApiPolicyText("not a policy")).toBe("not a policy");
  });

  it("treats an absent or empty policy as none", () => {
    expect(restApiPolicyText(undefined)).toBeNull();
    expect(restApiPolicyText("")).toBeNull();
  });
});

describe("restApiDetail", () => {
  it("reads what the page shows", () => {
    expect(
      restApiDetail({
        id: "a1b2c3d4e5",
        name: "orders",
        endpointConfiguration: { types: ["PRIVATE"], vpcEndpointIds: ["vpce-0abc"] },
        binaryMediaTypes: ["image/png"],
        minimumCompressionSize: 1024,
        disableExecuteApiEndpoint: true,
        tags: { team: "payments" },
        policy: JSON.stringify(policy),
      }),
    ).toMatchObject({
      id: "a1b2c3d4e5",
      endpointTypes: ["PRIVATE"],
      vpcEndpointIds: ["vpce-0abc"],
      binaryMediaTypes: ["image/png"],
      minimumCompressionSize: 1024,
      disableExecuteApiEndpoint: true,
      tags: { team: "payments" },
      policy: JSON.stringify(policy),
    });
  });

  it("fills in what an API leaves unset", () => {
    expect(restApiDetail({ id: "a1" })).toMatchObject({
      vpcEndpointIds: [],
      binaryMediaTypes: [],
      minimumCompressionSize: null,
      disableExecuteApiEndpoint: false,
      tags: {},
      policy: null,
    });
  });

  it("skips an API without an id", () => {
    expect(restApiDetail({ name: "ghost" })).toBeNull();
  });
});
