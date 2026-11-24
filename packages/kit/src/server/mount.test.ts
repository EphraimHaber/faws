import { describe, expect, expectTypeOf, it } from "vitest";

import { defineProviderServer, mountProviders } from "./mount.ts";
import { publicProcedure, router } from "./trpc.ts";

const alpha = defineProviderServer({
  id: "alpha",
  router: router({ ping: publicProcedure.query(() => "a") }),
});
const beta = defineProviderServer({
  id: "beta",
  router: router({ ping: publicProcedure.query(() => "b") }),
});

describe("mountProviders", () => {
  it("keys each router by its provider id", () => {
    const mounted = mountProviders([alpha, beta]);
    expect(mounted).toEqual({ alpha: alpha.router, beta: beta.router });
    expectTypeOf(mounted).toEqualTypeOf<{
      alpha: typeof alpha.router;
      beta: typeof beta.router;
    }>();
  });

  it("refuses the same id twice", () => {
    expect(() => mountProviders([alpha, alpha])).toThrow(/mounted twice/);
  });
});
