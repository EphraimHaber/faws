import type { BasePathMapping, CustomDomain, RestApiListing } from "@faws/contracts";
import { describe, expect, it } from "vitest";

import { dnsTarget, domainKey, mappedApi, mappingUrl, statusTone } from "./domains.ts";

function domain(extra: Partial<CustomDomain> = {}): CustomDomain {
  return {
    name: "api.example.com",
    domainNameId: null,
    arn: null,
    endpointTypes: [],
    regionalDomainName: null,
    regionalHostedZoneId: null,
    distributionDomainName: null,
    distributionHostedZoneId: null,
    certificateArn: null,
    certificateName: null,
    certificateUploadedAt: null,
    securityPolicy: null,
    status: null,
    statusMessage: null,
    routingMode: null,
    mutualTlsTruststoreUri: null,
    ownershipVerificationCertificateArn: null,
    tags: {},
    ...extra,
  };
}

const orders = {
  id: "a1b2c3",
  name: "orders",
  description: null,
  createdAt: null,
  version: null,
  endpointTypes: ["REGIONAL"],
  apiKeySource: null,
};

function listing(truncated = false): RestApiListing {
  return { apis: [orders], truncated };
}

function mapping(restApiId: string | null): BasePathMapping {
  return { basePath: "v1", restApiId, stage: "prod" };
}

describe("domainKey", () => {
  it("is the name of a public domain", () => {
    expect(domainKey(domain())).toBe("api.example.com");
  });

  it("joins a private domain's name and id", () => {
    expect(domainKey(domain({ domainNameId: "abcd1234" }))).toBe("api.example.com+abcd1234");
  });
});

describe("dnsTarget", () => {
  it("is the regional domain name when there is one", () => {
    expect(
      dnsTarget(domain({ regionalDomainName: "d-abc.execute-api.eu-west-1.amazonaws.com" })),
    ).toBe("d-abc.execute-api.eu-west-1.amazonaws.com");
  });

  it("is the CloudFront distribution of an edge domain", () => {
    expect(dnsTarget(domain({ distributionDomainName: "d111.cloudfront.net" }))).toBe(
      "d111.cloudfront.net",
    );
  });

  it("is nothing for a private domain", () => {
    expect(dnsTarget(domain())).toBeNull();
  });
});

describe("mappingUrl", () => {
  it("puts the base path after the domain", () => {
    expect(mappingUrl("api.example.com", "orders")).toBe("https://api.example.com/orders");
  });

  it("ends at the domain's root for the empty base path", () => {
    expect(mappingUrl("api.example.com", "")).toBe("https://api.example.com/");
  });
});

describe("mappedApi", () => {
  it("finds a REST API the listing holds", () => {
    expect(mappedApi(mapping("a1b2c3"), listing())).toEqual({ kind: "rest-api", api: orders });
  });

  it("calls an id the whole listing lacks unlisted", () => {
    expect(mappedApi(mapping("httpapi1"), listing())).toEqual({ kind: "unlisted" });
  });

  it("says nothing of an id while the listing is missing or cut short", () => {
    expect(mappedApi(mapping("httpapi1"), undefined)).toEqual({ kind: "unknown" });
    expect(mappedApi(mapping("httpapi1"), listing(true))).toEqual({ kind: "unknown" });
  });

  it("calls a mapping without an API unlisted", () => {
    expect(mappedApi(mapping(null), undefined)).toEqual({ kind: "unlisted" });
  });
});

describe("statusTone", () => {
  it("tells a settled domain from a changing, waiting or broken one", () => {
    expect(statusTone("AVAILABLE")).toBe("success");
    expect(statusTone("UPDATING")).toBe("info");
    expect(statusTone("PENDING_CERTIFICATE_REIMPORT")).toBe("warning");
    expect(statusTone("FAILED")).toBe("danger");
    expect(statusTone(null)).toBe("neutral");
  });
});
