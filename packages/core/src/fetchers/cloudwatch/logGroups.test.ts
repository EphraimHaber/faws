import { describe, expect, it } from "vitest";

import { exactLogGroup, logGroupEntry } from "./logGroups.ts";

describe("logGroupEntry", () => {
  it("reads a group", () => {
    expect(
      logGroupEntry({
        logGroupName: "/aws/api/access",
        logGroupArn: "arn:aws:logs:eu-west-1:123456789012:log-group:/aws/api/access",
        creationTime: 0,
        retentionInDays: 30,
        storedBytes: 2048,
        logGroupClass: "STANDARD",
      }),
    ).toEqual({
      name: "/aws/api/access",
      arn: "arn:aws:logs:eu-west-1:123456789012:log-group:/aws/api/access",
      createdAt: "1970-01-01T00:00:00.000Z",
      retentionDays: 30,
      storedBytes: 2048,
      logClass: "STANDARD",
    });
  });

  it("falls back to the older ARN field, and fills in what is unset", () => {
    expect(logGroupEntry({ logGroupName: "access", arn: "arn:x:*" })).toEqual({
      name: "access",
      arn: "arn:x:*",
      createdAt: null,
      retentionDays: null,
      storedBytes: null,
      logClass: null,
    });
  });

  it("skips a group without a name", () => {
    expect(logGroupEntry({})).toBeNull();
  });
});

describe("exactLogGroup", () => {
  const found = [
    { logGroupName: "API-Gateway-Execution-Logs_a1/prod" },
    { logGroupName: "API-Gateway-Execution-Logs_a1/prod-eu" },
  ];

  it("picks the group with exactly that name", () => {
    expect(exactLogGroup(found, "API-Gateway-Execution-Logs_a1/prod")?.name).toBe(
      "API-Gateway-Execution-Logs_a1/prod",
    );
  });

  it("is null when only longer names share the prefix", () => {
    expect(exactLogGroup(found.slice(1), "API-Gateway-Execution-Logs_a1/prod")).toBeNull();
    expect(exactLogGroup([], "API-Gateway-Execution-Logs_a1/prod")).toBeNull();
  });
});
