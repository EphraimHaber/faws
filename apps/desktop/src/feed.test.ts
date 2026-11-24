import { describe, expect, it } from "vitest";

import {
  GITHUB_FEED,
  manualDownloadUrl,
  normalizeFeedUrl,
  parsePolicy,
  policyPath,
  resolveFeed,
} from "./feed.ts";

describe("normalizeFeedUrl", () => {
  it("adds the trailing slash file names resolve against", () => {
    expect(normalizeFeedUrl(" https://nexus.corp/repository/faws ")).toBe(
      "https://nexus.corp/repository/faws/",
    );
  });

  it("refuses anything but http(s)", () => {
    expect(normalizeFeedUrl("file:///tmp/faws")).toBeNull();
    expect(normalizeFeedUrl("not a url")).toBeNull();
    expect(normalizeFeedUrl("")).toBeNull();
    expect(normalizeFeedUrl(undefined)).toBeNull();
  });
});

describe("resolveFeed", () => {
  const policy = { url: "https://policy.corp/faws", authorization: "Basic cG9saWN5" };

  it("is GitHub when nothing names a folder", () => {
    expect(resolveFeed({ env: {}, policy: {}, setting: "" })).toEqual(GITHUB_FEED);
  });

  it("takes the environment over the policy over the setting", () => {
    const setting = "https://mine.corp/faws";
    expect(
      resolveFeed({ env: { FAWS_UPDATE_URL: "https://env.corp/faws" }, policy, setting }).source,
    ).toBe("environment");
    expect(resolveFeed({ env: {}, policy, setting })).toEqual({
      source: "policy",
      url: "https://policy.corp/faws/",
      headers: { Authorization: "Basic cG9saWN5" },
    });
    expect(resolveFeed({ env: {}, policy: {}, setting })).toEqual({
      source: "setting",
      url: "https://mine.corp/faws/",
      headers: {},
    });
  });

  it("skips an invalid URL rather than breaking the check", () => {
    expect(resolveFeed({ env: { FAWS_UPDATE_URL: "ftp://x" }, policy: {}, setting: "" })).toEqual(
      GITHUB_FEED,
    );
  });

  it("prefers the environment's authorization", () => {
    const feed = resolveFeed({
      env: { FAWS_UPDATE_AUTHORIZATION: "Bearer env" },
      policy,
      setting: "",
    });
    expect(feed.headers).toEqual({ Authorization: "Bearer env" });
  });
});

describe("parsePolicy", () => {
  it("keeps only string fields", () => {
    expect(parsePolicy({ url: "https://a", authorization: 3, extra: true })).toEqual({
      url: "https://a",
    });
    expect(parsePolicy(null)).toEqual({});
    expect(parsePolicy("https://a")).toEqual({});
  });
});

describe("policyPath", () => {
  it("lives under ProgramData on Windows", () => {
    expect(policyPath("win32", { ProgramData: "D:\\PD" })).toMatch(/update-feed\.json$/);
    expect(policyPath("linux", {})).toBe("/etc/faws/update-feed.json");
  });
});

describe("manualDownloadUrl", () => {
  it("points at the dmg inside the folder", () => {
    expect(
      manualDownloadUrl("https://nexus.corp/faws/", [
        { url: "faws-0.2.0-arm64.zip" },
        { url: "faws-0.2.0-arm64.dmg" },
      ]),
    ).toBe("https://nexus.corp/faws/faws-0.2.0-arm64.dmg");
  });

  it("falls back to the folder", () => {
    expect(manualDownloadUrl("https://nexus.corp/faws/", [])).toBe("https://nexus.corp/faws/");
  });
});
