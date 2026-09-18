import type { S3BucketConfig } from "@faws/contracts";
import { useQuery } from "@tanstack/react-query";
import { Lock, LockOpen, ShieldAlert } from "lucide-react";
import * as React from "react";

import { JsonViewer } from "~/components/JsonViewer";
import { KeyValue, KeyValueGrid } from "~/components/kv";
import { Badge } from "~/components/ui/badge";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { Spinner } from "~/components/ui/spinner";
import { useAwsScope } from "~/contexts/ScopeContext";
import { trpc } from "~/lib/trpc";

/**
 * How the bucket is configured.
 *
 * Each field is a separate call with its own permission, so the pane says
 * which ones it could not read rather than showing a gap: not being allowed to
 * see the policy is a different fact from there being no policy.
 */
export function BucketProperties({ bucket }: { bucket: string }) {
  const scope = useAwsScope();
  const config = useQuery({
    ...trpc.s3.config.queryOptions({ ...scope, bucket }),
    staleTime: 5 * 60_000,
  });

  if (config.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (config.isError) {
    return <ErrorState error={config.error} onRetry={() => void config.refetch()} />;
  }

  const data = config.data;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
      {data.denied.length > 0 ? (
        <p className="flex items-center gap-2 rounded border border-warning/35 bg-warning/8 px-2.5 py-1.5 text-[11.5px]">
          <ShieldAlert className="size-3.5 shrink-0 text-warning" strokeWidth={1.7} />
          This profile cannot read: {data.denied.join(", ")}.
        </p>
      ) : null}

      <Panel className="shrink-0">
        <PanelHeader>
          <PanelTitle>Protection</PanelTitle>
        </PanelHeader>
        <KeyValueGrid className="px-3.5 py-3">
          <KeyValue label="Versioning">
            <Badge tone={data.versioning === "Enabled" ? "success" : "neutral"}>
              {data.versioning.toLowerCase()}
            </Badge>
          </KeyValue>
          <KeyValue label="MFA delete">{data.mfaDelete ? "on" : "off"}</KeyValue>
          <KeyValue label="Encryption">
            {data.encryption
              ? `${data.encryption.algorithm}${
                  data.encryption.kmsKeyId ? ` · ${data.encryption.kmsKeyId}` : ""
                }`
              : "none"}
          </KeyValue>
          <KeyValue label="Owner">{data.ownerName ?? "-"}</KeyValue>
        </KeyValueGrid>
      </Panel>

      <Panel className="shrink-0">
        <PanelHeader>
          <PanelTitle>Public access</PanelTitle>
          <PublicAccessSummary block={data.publicAccessBlock} />
        </PanelHeader>
        <KeyValueGrid className="px-3.5 py-3">
          <KeyValue label="Block public ACLs">
            {yesNo(data.publicAccessBlock?.blockPublicAcls)}
          </KeyValue>
          <KeyValue label="Ignore public ACLs">
            {yesNo(data.publicAccessBlock?.ignorePublicAcls)}
          </KeyValue>
          <KeyValue label="Block public policy">
            {yesNo(data.publicAccessBlock?.blockPublicPolicy)}
          </KeyValue>
          <KeyValue label="Restrict public buckets">
            {yesNo(data.publicAccessBlock?.restrictPublicBuckets)}
          </KeyValue>
        </KeyValueGrid>
      </Panel>

      {data.lifecycleRules.length > 0 ? (
        <Panel className="shrink-0">
          <PanelHeader>
            <PanelTitle>Lifecycle</PanelTitle>
            <span className="font-mono text-[11px] text-muted-foreground tabular">
              {data.lifecycleRules.length}
            </span>
          </PanelHeader>
          <ul className="flex flex-col divide-y divide-border">
            {data.lifecycleRules.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center gap-2 px-3.5 py-2">
                <Badge tone={rule.status === "Enabled" ? "success" : "neutral"}>
                  {rule.status.toLowerCase()}
                </Badge>
                <span className="font-mono text-[11.5px]">{rule.id || "(unnamed)"}</span>
                {rule.prefix ? (
                  <span className="font-mono text-[11px] text-muted-foreground">{rule.prefix}</span>
                ) : null}
                {rule.expiresAfterDays === null ? null : (
                  <span className="text-[11.5px] text-muted-foreground">
                    expires after {rule.expiresAfterDays}d
                  </span>
                )}
                {rule.transitions.map((transition) => (
                  <span
                    key={transition.storageClass}
                    className="text-[11.5px] text-muted-foreground"
                  >
                    → {transition.storageClass} at {transition.afterDays ?? "?"}d
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {Object.keys(data.tags).length > 0 ? (
        <Panel className="shrink-0">
          <PanelHeader>
            <PanelTitle>Tags</PanelTitle>
          </PanelHeader>
          <KeyValueGrid className="px-3.5 py-3">
            {Object.entries(data.tags).map(([key, value]) => (
              <KeyValue key={key} label={key}>
                {value}
              </KeyValue>
            ))}
          </KeyValueGrid>
        </Panel>
      ) : null}

      {data.policyJson ? (
        <Panel className="min-h-64 flex-1">
          <PanelHeader>
            <PanelTitle>Policy</PanelTitle>
          </PanelHeader>
          <PolicyDocument json={data.policyJson} />
        </Panel>
      ) : null}
    </div>
  );
}

function yesNo(value: boolean | undefined): string {
  return value === undefined ? "-" : value ? "yes" : "no";
}

/** The one line answer to "could a stranger read this bucket?" */
function PublicAccessSummary({ block }: { block: S3BucketConfig["publicAccessBlock"] }) {
  if (!block) {
    return (
      <Badge tone="warning">
        <LockOpen className="size-2.5" /> not blocked
      </Badge>
    );
  }
  const all =
    block.blockPublicAcls &&
    block.ignorePublicAcls &&
    block.blockPublicPolicy &&
    block.restrictPublicBuckets;
  return all ? (
    <Badge tone="success">
      <Lock className="size-2.5" /> fully blocked
    </Badge>
  ) : (
    <Badge tone="warning">
      <LockOpen className="size-2.5" /> partly blocked
    </Badge>
  );
}

/** The policy is stored as a JSON string, so it is parsed before it is shown. */
function PolicyDocument({ json }: { json: string }) {
  // Parsed outside the render, so a document that does not parse falls back to
  // its own text rather than throwing where nothing is left to catch it.
  const parsed = React.useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(json) as unknown };
    } catch {
      return { ok: false as const };
    }
  }, [json]);

  if (!parsed.ok) {
    return <pre className="overflow-auto p-3 font-mono text-[11.5px]">{json}</pre>;
  }
  return <JsonViewer value={parsed.value} />;
}
