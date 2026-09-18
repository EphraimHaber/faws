import { describe, expect, it } from "vitest";

import { classifyOpenAs, isReadable } from "./openAs.ts";

describe("classifyOpenAs", () => {
  it("believes a content type that says something", () => {
    expect(classifyOpenAs("thing", "image/png")).toBe("image");
    expect(classifyOpenAs("thing", "application/pdf")).toBe("pdf");
    expect(classifyOpenAs("thing", "text/csv")).toBe("csv");
    expect(classifyOpenAs("thing", "application/vnd.api+json")).toBe("json");
  });

  it("lets the content type override a misleading extension", () => {
    expect(classifyOpenAs("report.json", "image/png")).toBe("image");
  });

  it("ignores the parameters after a content type", () => {
    expect(classifyOpenAs("a", "text/plain; charset=utf-8")).toBe("text");
  });

  it("falls back to the extension when the type says nothing", () => {
    expect(classifyOpenAs("report.json", "application/octet-stream")).toBe("json");
    expect(classifyOpenAs("clip.mp4", null)).toBe("video");
    expect(classifyOpenAs("rows.tsv", "")).toBe("csv");
  });

  it("looks past a compression suffix to what is inside", () => {
    expect(classifyOpenAs("events.jsonl.gz", null)).toBe("jsonl");
    expect(classifyOpenAs("access.log.gz", null)).toBe("text");
  });

  it("shows an SVG as source, because it is a document that can carry script", () => {
    expect(classifyOpenAs("icon.svg", "image/svg+xml")).toBe("text");
    expect(classifyOpenAs("icon.svg", null)).toBe("text");
  });

  it("is binary when neither the type nor the name commits", () => {
    expect(classifyOpenAs("blob", null)).toBe("binary");
    expect(classifyOpenAs("archive.bin", "application/octet-stream")).toBe("binary");
  });
});

describe("isReadable", () => {
  it("allows the ordinary storage classes", () => {
    expect(isReadable("STANDARD", null)).toBe(true);
    expect(isReadable("INTELLIGENT_TIERING", null)).toBe(true);
  });

  it("refuses an archive with no restore", () => {
    expect(isReadable("GLACIER", null)).toBe(false);
    expect(isReadable("DEEP_ARCHIVE", null)).toBe(false);
  });

  it("refuses an archive whose restore is still running", () => {
    expect(isReadable("GLACIER", 'ongoing-request="true"')).toBe(false);
  });

  it("allows an archive whose restore has finished", () => {
    expect(
      isReadable("GLACIER", 'ongoing-request="false", expiry-date="Fri, 01 Jan 2027 00:00:00 GMT"'),
    ).toBe(true);
  });

  it("allows instant retrieval, which is an archive tier that still reads", () => {
    expect(isReadable("GLACIER_IR", null)).toBe(true);
  });
});
