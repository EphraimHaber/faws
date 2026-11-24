import { mountProviders, undeclaredMutations } from "@faws/kit/server";
import { kubernetesManifest } from "@faws/provider-kubernetes/manifest";
import { kubernetesServer } from "@faws/provider-kubernetes/server";
import type { inferRouterInputs } from "@trpc/server";
import { describe, expect, expectTypeOf, it } from "vitest";

import { appRouter, type AppRouter } from "./router.ts";

describe("appRouter", () => {
  it("has every mutation declare what it does to the world", () => {
    expect(undeclaredMutations(appRouter)).toEqual([]);
  });

  it("mounts Kubernetes under its provider id", () => {
    expect(Object.keys(mountProviders([kubernetesServer]))).toEqual([kubernetesManifest.id]);
    expectTypeOf<inferRouterInputs<AppRouter>>().toHaveProperty(kubernetesManifest.id);
  });
});
