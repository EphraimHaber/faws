import { describe, expect, it } from "vitest";

import { s3CapabilitiesFor, toS3Scope, type S3Connection } from "./s3-connections.ts";

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

describe("s3CapabilitiesFor", () => {
  it("offers everything when nothing but AWS is in scope", () => {
    expect(s3CapabilitiesFor(null)).toEqual({
      bucketRegions: true,
      storageMetrics: true,
      presign: true,
    });
  });

  it("withholds what only AWS can answer for an endpoint", () => {
    expect(s3CapabilitiesFor(connection)).toEqual({
      bucketRegions: false,
      storageMetrics: false,
      presign: true,
    });
  });

  it("offers metrics for an endpoint that says it is fronting AWS buckets", () => {
    expect(
      s3CapabilitiesFor({ ...connection, features: { storageMetrics: true, presign: false } }),
    ).toEqual({ bucketRegions: false, storageMetrics: true, presign: false });
  });
});

describe("toS3Scope", () => {
  it("leaves the connection out rather than setting it to undefined", () => {
    expect(toS3Scope({ profile: "default", region: "eu-west-1" })).toEqual({
      profile: "default",
      region: "eu-west-1",
    });
    expect(
      Object.hasOwn(toS3Scope({ profile: "d", region: "r", connectionId: null }), "connectionId"),
    ).toBe(false);
  });

  it("carries one that is set", () => {
    expect(toS3Scope({ profile: "d", region: "r", connectionId: "abc" })).toEqual({
      profile: "d",
      region: "r",
      connectionId: "abc",
    });
  });
});
