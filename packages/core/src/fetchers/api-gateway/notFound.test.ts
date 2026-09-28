import { AwsRequestError } from "@faws/contracts";
import { describe, expect, it } from "vitest";

import { nullIfNotFound } from "./notFound.ts";

describe("nullIfNotFound", () => {
  it("passes a result through", async () => {
    expect(await nullIfNotFound(async () => "found")).toBe("found");
  });

  it("reads NotFoundException as null", async () => {
    const missing = new AwsRequestError("Invalid API identifier specified", {
      code: "NotFoundException",
      service: "apigateway",
    });
    expect(
      await nullIfNotFound(async () => {
        throw missing;
      }),
    ).toBeNull();
  });

  it("rethrows any other fault", async () => {
    const denied = new AwsRequestError("denied", {
      code: "AccessDeniedException",
      service: "apigateway",
    });
    await expect(
      nullIfNotFound(async () => {
        throw denied;
      }),
    ).rejects.toBe(denied);
  });
});
