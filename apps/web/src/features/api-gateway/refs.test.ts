import { resourceKey, resourceRefSchema } from "@faws/contracts";
import { describe, expect, it } from "vitest";

import { restApiRef } from "./refs.ts";

const scope = { profile: "prod", region: "eu-west-1" };

describe("restApiRef", () => {
  it("keys an API by its id and links to its page", () => {
    const ref = restApiRef({ id: "a1b2c3d4e5", name: "orders" }, scope);
    expect(ref.id).toBe("a1b2c3d4e5");
    expect(ref.label).toBe("orders");
    expect(ref.to).toBe("/api-gateway/rest-apis/a1b2c3d4e5");
  });

  it("gives two APIs with one name two keys", () => {
    const first = restApiRef({ id: "aaaaaaaaaa", name: "orders" }, scope);
    const second = restApiRef({ id: "bbbbbbbbbb", name: "orders" }, scope);
    expect(resourceKey(first)).not.toBe(resourceKey(second));
  });

  it("builds a ref the settings file will accept, however long the name", () => {
    const ref = restApiRef({ id: "a1b2c3d4e5", name: "x".repeat(1024) }, scope);
    expect(resourceRefSchema.parse(ref)).toEqual(ref);
    expect(restApiRef({ id: "a1b2c3d4e5", name: "" }, scope).label).toBe("a1b2c3d4e5");
  });
});
