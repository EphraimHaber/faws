import { describe, expect, it } from "vitest";

import { basePathMapping, customDomain } from "./domains.ts";

describe("customDomain", () => {
  it("reads a regional domain", () => {
    expect(
      customDomain({
        domainName: "api.example.com",
        domainNameArn: "arn:aws:apigateway:eu-west-1::/domainnames/api.example.com",
        endpointConfiguration: { types: ["REGIONAL"] },
        regionalDomainName: "d-abc123.execute-api.eu-west-1.amazonaws.com",
        regionalHostedZoneId: "ZLY8HYME6SFDD",
        regionalCertificateArn: "arn:aws:acm:eu-west-1:123456789012:certificate/regional",
        regionalCertificateName: "api",
        securityPolicy: "TLS_1_2",
        domainNameStatus: "AVAILABLE",
        routingMode: "BASE_PATH_MAPPING_ONLY",
        tags: { team: "payments" },
      }),
    ).toEqual({
      name: "api.example.com",
      domainNameId: null,
      arn: "arn:aws:apigateway:eu-west-1::/domainnames/api.example.com",
      endpointTypes: ["REGIONAL"],
      regionalDomainName: "d-abc123.execute-api.eu-west-1.amazonaws.com",
      regionalHostedZoneId: "ZLY8HYME6SFDD",
      distributionDomainName: null,
      distributionHostedZoneId: null,
      certificateArn: "arn:aws:acm:eu-west-1:123456789012:certificate/regional",
      certificateName: "api",
      certificateUploadedAt: null,
      securityPolicy: "TLS_1_2",
      status: "AVAILABLE",
      statusMessage: null,
      routingMode: "BASE_PATH_MAPPING_ONLY",
      mutualTlsTruststoreUri: null,
      ownershipVerificationCertificateArn: null,
      tags: { team: "payments" },
    });
  });

  it("falls back to the edge certificate when there is no regional one", () => {
    const domain = customDomain({
      domainName: "edge.example.com",
      endpointConfiguration: { types: ["EDGE"] },
      distributionDomainName: "d111111abcdef8.cloudfront.net",
      certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/edge",
      certificateUploadDate: new Date("2026-01-02T03:04:05Z"),
    });
    expect(domain?.certificateArn).toBe("arn:aws:acm:us-east-1:123456789012:certificate/edge");
    expect(domain?.distributionDomainName).toBe("d111111abcdef8.cloudfront.net");
    expect(domain?.certificateUploadedAt).toBe("2026-01-02T03:04:05.000Z");
  });

  it("keeps a private domain's id, and drops a domain without a name", () => {
    expect(
      customDomain({ domainName: "private.example.com", domainNameId: "abcd1234" })?.domainNameId,
    ).toBe("abcd1234");
    expect(customDomain({ domainNameId: "abcd1234" })).toBeNull();
  });
});

describe("basePathMapping", () => {
  it("reads the root mapping as the empty path", () => {
    expect(basePathMapping({ basePath: "(none)", restApiId: "a1b2c3", stage: "prod" })).toEqual({
      basePath: "",
      restApiId: "a1b2c3",
      stage: "prod",
    });
  });

  it("keeps a named base path, and reads a missing stage as none", () => {
    expect(basePathMapping({ basePath: "orders", restApiId: "a1b2c3" })).toEqual({
      basePath: "orders",
      restApiId: "a1b2c3",
      stage: null,
    });
  });
});
