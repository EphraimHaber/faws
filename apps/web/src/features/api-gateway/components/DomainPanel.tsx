import type { BasePathMapping, CustomDomain, RestApiListing } from "@faws/contracts";
import { relativeTime } from "@faws/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Globe, X } from "lucide-react";

import { KeyValue, KeyValueGrid } from "~/components/kv";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { CopyButton } from "~/components/ui/copy-button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { SectionHeader } from "~/components/ui/section-header";
import { LoadingRows, Spinner } from "~/components/ui/spinner";
import { useAwsScope } from "~/stores/scope";
import { linkClass, TagsSection } from "~/features/api-gateway/components/parts";
import { dnsTarget, mappedApi, mappingUrl, statusTone } from "~/features/api-gateway/domains";
import { fullTimestamp } from "~/lib/format";
import { trpc } from "~/lib/trpc";

/**
 * One custom domain: how it is served, and which API and stage each of its
 * base paths goes to. `domain` is `null` when the URL names a domain the
 * region's listing does not hold.
 */
export function DomainPanel({
  domain,
  domainKey,
  onClose,
}: {
  domain: CustomDomain | null;
  domainKey: string;
  onClose: () => void;
}) {
  return (
    <Panel className="max-h-[60%] shrink-0">
      <PanelHeader>
        <PanelTitle className="truncate">{domain?.name ?? domainKey}</PanelTitle>
        {domain?.endpointTypes.map((type) => (
          <Badge key={type}>{type}</Badge>
        ))}
        {domain?.status ? (
          <Badge tone={statusTone(domain.status)}>{domain.status.replaceAll("_", " ")}</Badge>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close the domain"
          onClick={onClose}
          className="ml-auto"
        >
          <X className="size-3.5" />
        </Button>
      </PanelHeader>
      {domain ? (
        <DomainDetail domain={domain} />
      ) : (
        <EmptyState
          icon={Globe}
          title="No such custom domain"
          hint={`This region has no custom domain ${domainKey}, or it has been deleted.`}
        />
      )}
    </Panel>
  );
}

function DomainDetail({ domain }: { domain: CustomDomain }) {
  const target = dnsTarget(domain);

  return (
    <div className="flex min-h-0 flex-col overflow-auto">
      <section className="flex flex-col gap-2 px-3.5 py-3">
        {domain.statusMessage ? (
          <p className="text-[11.5px] text-warning">{domain.statusMessage}</p>
        ) : null}
        <KeyValueGrid>
          <KeyValue label="DNS target" className="col-span-2">
            {target ? (
              <span className="flex items-center gap-1.5">
                <span className="break-all">{target}</span>
                <CopyButton variant="ghost" size="icon" label="DNS target" value={target} />
              </span>
            ) : (
              "-"
            )}
          </KeyValue>
          <KeyValue label="Hosted zone">
            {domain.regionalHostedZoneId ?? domain.distributionHostedZoneId ?? "-"}
          </KeyValue>
          <KeyValue label="Security policy">{domain.securityPolicy ?? "-"}</KeyValue>
          <KeyValue label="Certificate" className="col-span-full">
            <span className="break-all">{domain.certificateArn ?? "-"}</span>
          </KeyValue>
          <KeyValue label="Certificate name">{domain.certificateName ?? "-"}</KeyValue>
          <KeyValue label="Certificate uploaded">
            <span title={fullTimestamp(domain.certificateUploadedAt)}>
              {relativeTime(domain.certificateUploadedAt)}
            </span>
          </KeyValue>
          <KeyValue label="Routing">{domain.routingMode ?? "-"}</KeyValue>
          <KeyValue label="Mutual TLS">
            <span className="break-all">{domain.mutualTlsTruststoreUri ?? "off"}</span>
          </KeyValue>
          {domain.ownershipVerificationCertificateArn ? (
            <KeyValue label="Ownership verification certificate" className="col-span-full">
              <span className="break-all">{domain.ownershipVerificationCertificateArn}</span>
            </KeyValue>
          ) : null}
          {domain.arn ? (
            <KeyValue label="ARN" className="col-span-full">
              <span className="break-all">{domain.arn}</span>
            </KeyValue>
          ) : null}
        </KeyValueGrid>
      </section>

      <Mappings domain={domain} />

      <TagsSection tags={domain.tags} />
    </div>
  );
}

/**
 * The domain's base path mappings, each checked against the region's REST
 * APIs: a mapping to one of them links to its stage, and one to anything else
 * is shown as the id AWS gave, since there is no page here to send it to.
 */
function Mappings({ domain }: { domain: CustomDomain }) {
  const scope = useAwsScope();
  const mappings = useQuery(
    trpc.apiGateway.basePathMappings.queryOptions({
      ...scope,
      domainName: domain.name,
      domainNameId: domain.domainNameId,
    }),
  );
  const apis = useQuery(trpc.apiGateway.restApis.queryOptions(scope));
  const count = mappings.data?.mappings.length;

  return (
    <section className="flex flex-col gap-2 px-3.5 pb-3">
      <SectionHeader
        title="Base path mappings"
        count={count === undefined ? undefined : `${count}${mappings.data?.truncated ? "+" : ""}`}
        action={mappings.isFetching || apis.isFetching ? <Spinner className="size-3" /> : undefined}
      />
      {mappings.isPending ? (
        <LoadingRows rows={2} />
      ) : mappings.isError ? (
        <ErrorState error={mappings.error} onRetry={() => void mappings.refetch()} />
      ) : mappings.data === null ? (
        <p className="text-[12px] text-warning">
          This domain has been deleted since it was listed.
        </p>
      ) : mappings.data.mappings.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">
          {domain.routingMode === "ROUTING_RULE_ONLY"
            ? "None: this domain sends requests on by routing rules instead."
            : "None: nothing is served on this domain yet."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {mappings.data.mappings.map((mapping) => (
            <MappingRow
              key={mapping.basePath}
              domainName={domain.name}
              mapping={mapping}
              apis={apis.isError ? undefined : apis.data}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function MappingRow({
  domainName,
  mapping,
  apis,
}: {
  domainName: string;
  mapping: BasePathMapping;
  apis: RestApiListing | undefined;
}) {
  const url = mappingUrl(domainName, mapping.basePath);
  const target = mappedApi(mapping, apis);

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border/70 px-3 py-2">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="font-mono text-[12px] break-all">/{mapping.basePath}</span>
        <CopyButton variant="ghost" size="icon" label="URL" value={url} />
      </span>
      <ArrowRight aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 items-center gap-2 text-[12px]">
        {target.kind === "unlisted" || !mapping.restApiId ? (
          <span
            className="font-mono text-muted-foreground"
            title="Not a REST API in this region: an HTTP or WebSocket API, or one since deleted."
          >
            {mapping.restApiId ?? "no API"} · not a REST API here
          </span>
        ) : (
          <Link
            to="/api-gateway/rest-apis/$apiId"
            params={{ apiId: mapping.restApiId }}
            search={{ tab: "stages", ...(mapping.stage ? { stage: mapping.stage } : {}) }}
            className={linkClass}
          >
            {target.kind === "rest-api" ? (
              <>
                {target.api.name}
                <span className="font-mono text-[11px] text-muted-foreground">
                  {mapping.restApiId}
                </span>
              </>
            ) : (
              <span className="font-mono">{mapping.restApiId}</span>
            )}
          </Link>
        )}
        {mapping.stage ? (
          <Badge tone="success">{mapping.stage}</Badge>
        ) : (
          <span
            className="font-mono text-[11px] text-muted-foreground"
            title="No stage is mapped, so callers name the stage in the path after the base path."
          >
            stage from path
          </span>
        )}
      </span>
    </li>
  );
}
