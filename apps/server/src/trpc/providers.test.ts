import { applyPatch, DEFAULT_SETTINGS, type Settings } from "@faws/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

let settings: Settings = DEFAULT_SETTINGS;

vi.mock("../api/settings/settings.instance.ts", () => ({
  settingsStore: () => ({ get: () => ({ settings }) }),
}));

const { awsProcedure, storageProcedure, storageProviderOf } = await import("./providers.ts");
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
  it("answer to the provider their connection names", async () => {
    const onAws = { ref: { provider: "aws", id: "default@eu-west-1" } };
    const onMinio = { ref: { provider: "s3", id: "minio" } };

    switchOff("aws");
    await expect(caller.buckets(onAws as never)).rejects.toThrow("AWS is switched off");
    await expect(caller.buckets(onMinio as never)).resolves.toBe("buckets");

    switchOff("s3");
    await expect(caller.buckets(onMinio as never)).rejects.toThrow(
      "Storage endpoints is switched off",
    );
  });

  it("names the provider from the connection alone", () => {
    expect(storageProviderOf({ ref: { provider: "s3", id: "minio" } })).toBe("s3");
    expect(storageProviderOf({ ref: { provider: "aws", id: "default@us-east-1" } })).toBe("aws");
    expect(storageProviderOf({ uploadToken: "t" })).toBeNull();
    expect(storageProviderOf({ ref: "aws" })).toBeNull();
    expect(storageProviderOf(undefined)).toBeNull();
  });
});
