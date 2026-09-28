/**
 * What API Gateway things are remembered as, in the pinned and recent lists.
 *
 * One builder per kind, so a list row and the page showing the same thing pin
 * the same `resourceKey` and toggle together.
 */
import type { ResourceRef } from "@faws/contracts";

interface AwsScope {
  readonly profile: string;
  readonly region: string;
}

/**
 * The id is the API's id rather than its name: names need not be unique in a
 * region, and the id is what the route carries.
 */
export function restApiRef(api: { id: string; name: string }, scope: AwsScope): ResourceRef {
  return {
    kind: "api-gateway-rest-api",
    id: api.id,
    label: (api.name || api.id).slice(0, 200),
    detail: `REST API · ${api.id}`,
    scope: { profile: scope.profile, region: scope.region, connectionId: "" },
    to: `/api-gateway/rest-apis/${encodeURIComponent(api.id)}`,
  };
}
