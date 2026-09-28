import type { RestApiAuthorizer } from "@faws/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLink, ShieldCheck } from "lucide-react";
import * as React from "react";

import { KeyValue, KeyValueGrid } from "~/components/kv";
import { Badge } from "~/components/ui/badge";
import { CopyButton } from "~/components/ui/copy-button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { SectionHeader } from "~/components/ui/section-header";
import { LoadingRows } from "~/components/ui/spinner";
import { useAwsScope } from "~/contexts/ScopeContext";
import { linkClass, TruncatedNote } from "~/features/api-gateway/components/parts";
import {
  type AuthorizedMethod,
  lambdaFromUri,
  methodsByAuthorizer,
} from "~/features/api-gateway/authorizers";
import { withoutListSearch } from "~/hooks/useSearchState";
import { trpc } from "~/lib/trpc";

/** Every authorizer of the API, each with what it calls and the methods it guards. */
export function AuthorizersPane({ apiId }: { apiId: string }) {
  const scope = useAwsScope();
  const listing = useQuery(trpc.apiGateway.authorizers.queryOptions({ ...scope, apiId }));
  // The methods each authorizer guards are only on the resources.
  const resources = useQuery(trpc.apiGateway.resources.queryOptions({ ...scope, apiId }));
  const guarded = React.useMemo(
    () => methodsByAuthorizer(resources.data?.resources ?? []),
    [resources.data],
  );

  if (listing.isPending) return <LoadingRows rows={8} />;
  if (listing.isError) {
    return <ErrorState error={listing.error} onRetry={() => void listing.refetch()} />;
  }
  if (listing.data.authorizers.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="This API has no authorizers"
        hint="Its methods are open, or checked with IAM or an API key."
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      {listing.data.truncated ? (
        <TruncatedNote
          count={listing.data.authorizers.length}
          noun="authorizers"
          place="banner"
          className="px-3.5"
        />
      ) : null}
      {listing.data.authorizers.map((authorizer) => (
        <AuthorizerDetail
          key={authorizer.id}
          apiId={apiId}
          authorizer={authorizer}
          methods={resources.data ? (guarded.get(authorizer.id) ?? []) : null}
        />
      ))}
    </div>
  );
}

function AuthorizerDetail({
  apiId,
  authorizer,
  methods,
}: {
  apiId: string;
  authorizer: RestApiAuthorizer;
  /** `null` while the API's resources are still loading. */
  methods: ReadonlyArray<AuthorizedMethod> | null;
}) {
  const lambda = authorizer.authorizerUri ? lambdaFromUri(authorizer.authorizerUri) : null;

  return (
    <section className="flex flex-col gap-2 border-b border-border px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate font-mono text-[12.5px] text-foreground">
          {authorizer.name}
        </span>
        {authorizer.type ? <Badge tone="primary">{authorizer.type}</Badge> : null}
        <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">
          {authorizer.id}
        </span>
        <CopyButton variant="ghost" size="icon" label="authorizer id" value={authorizer.id} />
      </div>

      <KeyValueGrid>
        <KeyValue label="Identity source" className="col-span-full sm:col-span-1">
          <span className="break-all">{authorizer.identitySource ?? "-"}</span>
        </KeyValue>
        <KeyValue label="Validation expression">
          <span className="break-all">{authorizer.identityValidationExpression ?? "-"}</span>
        </KeyValue>
        <KeyValue label="Result cache">{ttlLabel(authorizer.resultTtlSeconds)}</KeyValue>
        {lambda ? (
          <KeyValue label="Lambda function">
            <a
              href={`https://${lambda.region}.console.aws.amazon.com/lambda/home?region=${lambda.region}#/functions/${encodeURIComponent(lambda.name)}`}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
              title={`${lambda.arn} in the AWS console`}
            >
              {lambda.qualifier ? `${lambda.name}:${lambda.qualifier}` : lambda.name}
              <ExternalLink className="size-3 shrink-0" />
            </a>
          </KeyValue>
        ) : null}
        {authorizer.authorizerUri ? (
          <KeyValue label="Authorizer URI" className="col-span-full">
            <span className="break-all">{authorizer.authorizerUri}</span>
          </KeyValue>
        ) : null}
        {authorizer.type !== "COGNITO_USER_POOLS" ? (
          <KeyValue label="Credentials" className="col-span-full">
            <span className="break-all">
              {authorizer.credentials ?? "none: invoked through the function's resource policy"}
            </span>
          </KeyValue>
        ) : null}
        {authorizer.providerArns.length > 0 ? (
          <KeyValue label="User pools" className="col-span-full">
            <ul className="flex flex-col gap-0.5">
              {authorizer.providerArns.map((arn) => (
                <li key={arn} className="break-all">
                  {arn}
                </li>
              ))}
            </ul>
          </KeyValue>
        ) : null}
      </KeyValueGrid>

      {methods === null ? null : (
        <>
          <SectionHeader title="Guards" count={methods.length} />
          {methods.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">No method uses this authorizer.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {methods.map((method) => (
                <li key={`${method.resourceId} ${method.httpMethod}`}>
                  <Link
                    to="/api-gateway/rest-apis/$apiId"
                    params={{ apiId }}
                    search={(prev) => ({
                      ...withoutListSearch(prev),
                      tab: "resources",
                      resource: method.resourceId,
                    })}
                    className="inline-flex items-center gap-2 font-mono text-[11.5px] hover:text-primary"
                  >
                    <Badge tone="primary">{method.httpMethod}</Badge>
                    <span className="break-all">{method.path}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function ttlLabel(seconds: number | null): string {
  if (seconds === null) return "-";
  return seconds === 0 ? "off" : `${seconds} s`;
}
