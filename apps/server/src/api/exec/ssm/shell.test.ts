import { describe, expect, it, vi } from "vitest";

import { BASH_COMMAND, startPreferringBash, type StartRequest } from "./shell.ts";

function denied(): Error {
  return Object.assign(new Error("not authorized to use AWS-StartInteractiveCommand"), {
    name: "AccessDeniedException",
  });
}

describe("startPreferringBash", () => {
  it("asks for bash through the interactive-command document on Linux", async () => {
    const start = vi.fn(async (request: StartRequest) => ({ id: "s-1", request }));
    const { request } = await startPreferringBash(start, "i-0abc", "Linux", () => {});
    expect(request).toEqual({
      Target: "i-0abc",
      DocumentName: "AWS-StartInteractiveCommand",
      Parameters: { command: [BASH_COMMAND] },
    });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default shell when the document is not allowed, and says so", async () => {
    const start = vi
      .fn<(request: StartRequest) => Promise<string>>()
      .mockRejectedValueOnce(denied())
      .mockResolvedValueOnce("s-2");
    const onFallback = vi.fn();
    const { started, request } = await startPreferringBash(start, "i-0abc", "Linux", onFallback);
    expect(started).toBe("s-2");
    expect(request).toEqual({ Target: "i-0abc" });
    expect(onFallback).toHaveBeenCalledWith(expect.stringContaining("AWS-StartInteractiveCommand"));
  });

  it("does not retry a failure that is not about the document", async () => {
    const offline = Object.assign(new Error("offline"), { name: "TargetNotConnected" });
    const start = vi.fn().mockRejectedValue(offline);
    await expect(startPreferringBash(start, "i-0abc", "Linux", () => {})).rejects.toBe(offline);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("leaves Windows, and an unknown platform, on the default shell", async () => {
    for (const platform of ["Windows", undefined]) {
      const start = vi.fn(async (request: StartRequest) => request);
      const { request } = await startPreferringBash(start, "i-0abc", platform, () => {});
      expect(request).toEqual({ Target: "i-0abc" });
    }
  });
});

describe("BASH_COMMAND", () => {
  it("starts in the home directory and falls back to sh where there is no bash", () => {
    expect(BASH_COMMAND).toMatch(/^cd;/);
    expect(BASH_COMMAND).toContain("exec bash -l");
    expect(BASH_COMMAND).toContain("exec sh");
  });
});
