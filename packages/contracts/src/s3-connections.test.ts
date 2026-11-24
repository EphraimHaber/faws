import { describe, expect, it } from "vitest";

import { awsConnectionRef, awsScopeOf } from "./aws.ts";
import { s3EndpointFeatures, s3EndpointRef, type S3Connection } from "./s3-connections.ts";

const connection: S3Connection = {
  id: "abc",
  name: "MinIO",
  endpoint: "https://s3.corp.internal:9000",
  region: "us-east-1",
  forcePathStyle: true,
  credentials: { mode: "anonymous" },
  tls: {
    verify: true,
    caPaths: [],
    caPem: null,
    clientCertPath: null,
    clientKeyPath: null,
    servername: null,
    pinnedSha256: null,
  },
  features: { storageMetrics: false, presign: true },
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("s3EndpointFeatures", () => {
  it("withholds what only AWS can answer", () => {
    expect(s3EndpointFeatures(connection)).toEqual({
      bucketRegions: false,
      storageMetrics: false,
      presign: true,
    });
  });

  it("offers metrics for an endpoint that says it is fronting AWS buckets", () => {
    expect(
      s3EndpointFeatures({ ...connection, features: { storageMetrics: true, presign: false } }),
    ).toEqual({ bucketRegions: false, storageMetrics: true, presign: false });
  });
});

describe("connection refs", () => {
  it("name a saved endpoint by its id", () => {
    expect(s3EndpointRef("abc")).toEqual({ provider: "s3", id: "abc" });
  });

  it("round trip an AWS scope, including a profile with an @ in it", () => {
    for (const scope of [
      { profile: "default", region: "eu-west-1" },
      { profile: "me@corp", region: "us-east-1" },
      { profile: "", region: "ap-south-1" },
    ]) {
      expect(awsScopeOf(awsConnectionRef(scope))).toEqual(scope);
    }
  });

  it("refuse anything that is not an AWS scope", () => {
    expect(awsScopeOf({ provider: "s3", id: "a@b" })).toBeNull();
    expect(awsScopeOf({ provider: "aws", id: "no-region" })).toBeNull();
    expect(awsScopeOf({ provider: "aws", id: "trailing@" })).toBeNull();
  });
});
