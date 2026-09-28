import type {
  BasePathMapping,
  CustomDomain,
  RestApiListing,
  RestApiSummary,
} from "@faws/contracts";

/**
 * How a domain is named in the URL: its name, or for a private domain its
 * name and id joined as AWS joins them in the domain's ARN, since a private
 * domain can share its name with a public one.
 */
export function domainKey(domain: Pick<CustomDomain, "name" | "domainNameId">): string {
  return domain.domainNameId ? `${domain.name}+${domain.domainNameId}` : domain.name;
}

/** What the domain's DNS record should point at. */
export function dnsTarget(domain: CustomDomain): string | null {
  return domain.regionalDomainName ?? domain.distributionDomainName;
}

/** The URL a mapping answers on. */
export function mappingUrl(domainName: string, basePath: string): string {
  return `https://${domainName}/${basePath}`;
}

/**
 * What a mapping's API is, judged against the region's REST API listing.
 *
 * - `rest-api`: a REST API the listing holds.
 * - `unlisted`: none the listing holds, and the listing is whole, so it is an
 *   HTTP or WebSocket API, or one since deleted.
 * - `unknown`: the listing is not in yet, failed or was cut short, so nothing
 *   can be said and the mapping is taken at its word.
 */
export type MappedApi =
  | { readonly kind: "rest-api"; readonly api: RestApiSummary }
  | { readonly kind: "unlisted" }
  | { readonly kind: "unknown" };

export function mappedApi(
  mapping: BasePathMapping,
  listing: RestApiListing | undefined,
): MappedApi {
  if (!mapping.restApiId) return { kind: "unlisted" };
  const api = listing?.apis.find((candidate) => candidate.id === mapping.restApiId);
  if (api) return { kind: "rest-api", api };
  if (!listing || listing.truncated) return { kind: "unknown" };
  return { kind: "unlisted" };
}

/** The badge tone for a domain's status: settled, changing, waiting on someone, or broken. */
export function statusTone(
  status: string | null,
): "success" | "info" | "warning" | "danger" | "neutral" {
  if (status === "AVAILABLE") return "success";
  if (status === "UPDATING") return "info";
  if (status === "FAILED") return "danger";
  if (status?.startsWith("PENDING")) return "warning";
  return "neutral";
}
