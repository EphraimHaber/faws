import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { HOST_SERVICES, PROVIDERS, SERVICES } from "./registry";

/**
 * The manifests are data and the routes are code, so nothing but this test
 * notices a section pointing at a page that was renamed or never added.
 *
 * The route paths are read from the router's source: every route there is
 * declared flat with its full path, and importing the router would need a DOM.
 */
const ROUTE_PATHS = new Set(
  [
    ...readFileSync(new URL("../router.tsx", import.meta.url), "utf8").matchAll(
      /\bpath: "([^"]+)"/g,
    ),
  ].map((match) => match[1]),
);

describe("provider manifests", () => {
  const paths = ROUTE_PATHS;

  it("link only to pages that exist", () => {
    const missing: string[] = [];
    for (const service of SERVICES) {
      if (service.status !== "available") continue;
      if (!paths.has(service.basePath)) missing.push(`${service.id}: ${service.basePath}`);
      for (const section of service.sections) {
        if (section.to && !paths.has(section.to))
          missing.push(`${service.id}.${section.id}: ${section.to}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("give every service and provider a unique id", () => {
    const ids = SERVICES.map((service) => service.id);
    expect(new Set(ids).size).toBe(ids.length);
    const providerIds = PROVIDERS.map((provider) => provider.id);
    expect(new Set(providerIds).size).toBe(providerIds.length);
  });

  it("keep the app's own services free of any provider", () => {
    expect(HOST_SERVICES.every((service) => service.owner === "host")).toBe(true);
  });
});
