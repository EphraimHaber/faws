import { undeclaredMutations } from "@faws/kit/server";
import { describe, expect, it } from "vitest";

import { appRouter } from "./router.ts";

describe("appRouter", () => {
  it("has every mutation declare what it does to the world", () => {
    expect(undeclaredMutations(appRouter)).toEqual([]);
  });
});
