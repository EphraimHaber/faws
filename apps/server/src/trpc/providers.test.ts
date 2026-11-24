import { applyPatch, DEFAULT_SETTINGS, type Settings } from "@faws/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

let settings: Settings = DEFAULT_SETTINGS;

vi.mock("../api/settings/settings.instance.ts", () => ({
  settingsStore: () => ({ get: () => ({ settings }) }),
}));

const { awsProcedure, storageOwner, storageProcedure } = await import("./providers.ts");
const { router } = await import("./index.ts");

const testRouter = router({
  whoami: awsProcedure.query(() => "me"),
  buckets: storageProcedure.query(() => "buckets"),
});
const caller = testRouter.createCaller({});

function switchOff(id: "aws" | "s3") {
  settings = applyPatch(DEFAULT_SETTINGS, { providers: { [id]: { enabled: false } } });
}

beforeEach(() => {
  settings = DEFAULT_SETTINGS;
});

describe("provider procedures", () => {
  it("answer while their provider is on", async () => {
    await expect(caller.whoami()).resolves.toBe("me");
  });

  it("refuse while it is off, saying which and how to fix it", async () => {
    switchOff("aws");
    const error = await caller.whoami().catch((err: unknown) => err);
    expect(error).toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "AWS is switched off. Turn it on in Settings to use it.",
    });
  });
});

describe("storage procedures", () => {
  it("answer to AWS for a profile and to the endpoints provider for a connection", async () => {
    switchOff("aws");
    await expect(
      caller.buckets({ profile: "default", region: "eu-west-1" } as never),
    ).rejects.toThrow("AWS is switched off");
    await expect(
      caller.buckets({ profile: "", region: "x", connectionId: "minio" } as never),
    ).resolves.toBe("buckets");

    switchOff("s3");
    await expect(
      caller.buckets({ profile: "", region: "x", connectionId: "minio" } as never),
    ).rejects.toThrow("Storage endpoints is switched off");
  });

  it("names the owner from the scope alone", () => {
    expect(storageOwner({ connectionId: "minio", profile: "" })).toBe("s3");
    expect(storageOwner({ connectionId: "", profile: "default" })).toBe("aws");
    expect(storageOwner({ uploadToken: "t" })).toBeNull();
    expect(storageOwner(undefined)).toBeNull();
  });
});
