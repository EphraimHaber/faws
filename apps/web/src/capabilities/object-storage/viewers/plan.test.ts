import type { S3ObjectHead, S3OpenAs } from "@faws/contracts";
import { describe, expect, it } from "vitest";

import { HEAD_SLICE, planFor, REFUSE_LIMIT, WHOLE_LIMIT } from "./plan.ts";

function head(overrides: Partial<S3ObjectHead> & { openAs: S3OpenAs; size: number }): S3ObjectHead {
  return {
    bucket: "b",
    key: "k",
    contentType: null,
    contentEncoding: null,
    lastModified: null,
    etag: null,
    versionId: null,
    storageClass: "STANDARD",
    serverSideEncryption: null,
    kmsKeyId: null,
    metadata: {},
    readable: true,
    restore: null,
    ...overrides,
  };
}

describe("planFor", () => {
  it("reads a small text object whole", () => {
    expect(planFor(head({ openAs: "json", size: 1000 }))).toEqual({
      kind: "whole",
      openAs: "json",
    });
  });

  it("takes a leading slice of a middling one", () => {
    const plan = planFor(head({ openAs: "text", size: WHOLE_LIMIT + 1 }));
    expect(plan).toEqual({ kind: "slice", openAs: "text", bytes: HEAD_SLICE });
  });

  it("refuses to open a large one blind", () => {
    expect(planFor(head({ openAs: "csv", size: REFUSE_LIMIT + 1 }))).toEqual({
      kind: "refuse",
      reason: "size",
    });
  });

  it("streams media whatever its size", () => {
    expect(planFor(head({ openAs: "video", size: 40 * 1024 ** 3 }))).toEqual({
      kind: "stream",
      openAs: "video",
    });
    expect(planFor(head({ openAs: "pdf", size: REFUSE_LIMIT * 4 }))).toEqual({
      kind: "stream",
      openAs: "pdf",
    });
  });

  it("offers nothing to render for an unknown kind", () => {
    expect(planFor(head({ openAs: "binary", size: 10 }))).toEqual({ kind: "binary" });
  });

  it("reports an archived object as unavailable rather than failing to fetch it", () => {
    const archived = head({ openAs: "json", size: 10, readable: false, storageClass: "GLACIER" });
    expect(planFor(archived)).toEqual({ kind: "refuse", reason: "archived" });
  });

  it("puts availability ahead of size, so the message names the real cause", () => {
    const archived = head({
      openAs: "video",
      size: 10,
      readable: false,
      storageClass: "DEEP_ARCHIVE",
    });
    expect(planFor(archived)).toEqual({ kind: "refuse", reason: "archived" });
  });
});
