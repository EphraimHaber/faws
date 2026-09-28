import type { RestApiDetail } from "@faws/contracts";
import { byteSize, relativeTime } from "@faws/shared";

import { KeyValue, KeyValueGrid } from "~/components/kv";
import { Badge } from "~/components/ui/badge";
import { CopyButton } from "~/components/ui/copy-button";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { JsonText } from "~/features/api-gateway/components/JsonText";
import { fullTimestamp } from "~/lib/format";

/** How a REST API is set up as a whole, apart from its paths. */
export function RestApiOverview({ api }: { api: RestApiDetail }) {
  const tags = Object.entries(api.tags);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
      <KeyValueGrid className="px-0.5">
        <KeyValue label="API id">{api.id}</KeyValue>
        <KeyValue label="Name" mono={false}>
          {api.name}
        </KeyValue>
        <KeyValue label="Description" mono={false}>
          {api.description ?? "-"}
        </KeyValue>
        <KeyValue label="Endpoint type">
          {api.endpointTypes.length === 0 ? "-" : api.endpointTypes.join(", ")}
        </KeyValue>
        <KeyValue label="VPC endpoints">
          {api.vpcEndpointIds.length === 0 ? "-" : api.vpcEndpointIds.join(", ")}
        </KeyValue>
        <KeyValue label="Default endpoint">
          {api.disableExecuteApiEndpoint ? (
            <Badge tone="warning">disabled</Badge>
          ) : (
            "execute-api, enabled"
          )}
        </KeyValue>
        <KeyValue label="API key source">{api.apiKeySource ?? "-"}</KeyValue>
        <KeyValue label="Binary media types">
          {api.binaryMediaTypes.length === 0 ? "-" : api.binaryMediaTypes.join(", ")}
        </KeyValue>
        <KeyValue label="Compression">
          {api.minimumCompressionSize === null
            ? "off"
            : `from ${byteSize(api.minimumCompressionSize)}`}
        </KeyValue>
        <KeyValue label="Created">
          <span title={fullTimestamp(api.createdAt)}>{relativeTime(api.createdAt)}</span>
        </KeyValue>
        <KeyValue label="Version">{api.version ?? "-"}</KeyValue>
        <KeyValue label="Resource policy">{api.policy ? "set" : "none"}</KeyValue>
      </KeyValueGrid>

      {tags.length > 0 ? (
        <Panel className="shrink-0">
          <PanelHeader>
            <PanelTitle>Tags</PanelTitle>
            <span className="font-mono text-[11px] text-muted-foreground tabular">
              {tags.length}
            </span>
          </PanelHeader>
          <KeyValueGrid className="px-3.5 py-3">
            {tags.map(([key, value]) => (
              <KeyValue key={key} label={key}>
                {value}
              </KeyValue>
            ))}
          </KeyValueGrid>
        </Panel>
      ) : null}

      {api.policy ? (
        <Panel className="min-h-64 flex-1">
          <PanelHeader>
            <PanelTitle>Resource policy</PanelTitle>
            <CopyButton
              variant="ghost"
              size="icon"
              label="resource policy"
              value={api.policy}
              className="ml-auto"
            />
          </PanelHeader>
          <JsonText text={api.policy} />
        </Panel>
      ) : null}
    </div>
  );
}
