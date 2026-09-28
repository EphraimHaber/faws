import {
  type BasePathMapping as AwsBasePathMapping,
  type DomainName,
  GetBasePathMappingsCommand,
  GetDomainNamesCommand,
} from "@aws-sdk/client-api-gateway";
import {
  AwsRequestError,
  type AwsScope,
  type BasePathMapping,
  type BasePathMappingListing,
  type CustomDomain,
  type CustomDomainListing,
} from "@faws/contracts";
import { toIso } from "@faws/shared";

import { apiGatewayClient, callAws } from "../../clients.ts";

/** GetDomainNames returns at most 500 a page; a region rarely holds this many. */
const MAX_DOMAIN_PAGES = 10;

/** GetBasePathMappings returns at most 500 a page. */
const MAX_MAPPING_PAGES = 5;

/** What AWS calls the mapping at a domain's root. */
const ROOT_BASE_PATH = "(none)";

/** A listed domain as the page shows it, or `null` for one without a name. */
export function customDomain(domain: DomainName): CustomDomain | null {
  if (!domain.domainName) return null;
  return {
    name: domain.domainName,
    domainNameId: domain.domainNameId || null,
    arn: domain.domainNameArn || null,
    endpointTypes: domain.endpointConfiguration?.types ?? [],
    regionalDomainName: domain.regionalDomainName || null,
    regionalHostedZoneId: domain.regionalHostedZoneId || null,
    distributionDomainName: domain.distributionDomainName || null,
    distributionHostedZoneId: domain.distributionHostedZoneId || null,
    certificateArn: domain.regionalCertificateArn || domain.certificateArn || null,
    certificateName: domain.regionalCertificateName || domain.certificateName || null,
    certificateUploadedAt: toIso(domain.certificateUploadDate),
    securityPolicy: domain.securityPolicy ?? null,
    status: domain.domainNameStatus ?? null,
    statusMessage: domain.domainNameStatusMessage || null,
    routingMode: domain.routingMode ?? null,
    mutualTlsTruststoreUri: domain.mutualTlsAuthentication?.truststoreUri || null,
    ownershipVerificationCertificateArn: domain.ownershipVerificationCertificateArn || null,
    tags: domain.tags ?? {},
  };
}

/** A listed mapping, with the root's `(none)` read as the empty path. */
export function basePathMapping(mapping: AwsBasePathMapping): BasePathMapping {
  const basePath = mapping.basePath ?? "";
  return {
    basePath: basePath === ROOT_BASE_PATH ? "" : basePath,
    restApiId: mapping.restApiId || null,
    stage: mapping.stage || null,
  };
}

/** Every custom domain the account owns in the region, by name, up to a cap. */
export async function listDomainNames(scope: AwsScope): Promise<CustomDomainListing> {
  const client = apiGatewayClient(scope);
  const domains: CustomDomain[] = [];
  let position: string | undefined;
  let pages = 0;
  do {
    const page = await callAws("apigateway", () =>
      client.send(new GetDomainNamesCommand({ limit: 500, ...(position ? { position } : {}) })),
    );
    for (const item of page.items ?? []) {
      const domain = customDomain(item);
      if (domain) domains.push(domain);
    }
    position = page.position;
    pages += 1;
  } while (position && pages < MAX_DOMAIN_PAGES);

  return {
    domains: domains.toSorted(
      (a, b) =>
        a.name.localeCompare(b.name) || (a.domainNameId ?? "").localeCompare(b.domainNameId ?? ""),
    ),
    truncated: Boolean(position),
  };
}

/**
 * Every base path mapping of one custom domain, by base path, or `null` when
 * the region has no such domain. A private domain is named by its id as well.
 */
export async function listBasePathMappings(
  scope: AwsScope,
  domainName: string,
  domainNameId: string | null,
): Promise<BasePathMappingListing | null> {
  const client = apiGatewayClient(scope);
  const mappings: BasePathMapping[] = [];
  let position: string | undefined;
  let pages = 0;
  try {
    do {
      const page = await callAws("apigateway", () =>
        client.send(
          new GetBasePathMappingsCommand({
            domainName,
            ...(domainNameId ? { domainNameId } : {}),
            limit: 500,
            ...(position ? { position } : {}),
          }),
        ),
      );
      for (const item of page.items ?? []) mappings.push(basePathMapping(item));
      position = page.position;
      pages += 1;
    } while (position && pages < MAX_MAPPING_PAGES);
  } catch (err) {
    // A stale link to a deleted domain is an answer, not a fault.
    if (err instanceof AwsRequestError && err.code === "NotFoundException") return null;
    throw err;
  }

  return {
    mappings: mappings.toSorted((a, b) => a.basePath.localeCompare(b.basePath)),
    truncated: Boolean(position),
  };
}
