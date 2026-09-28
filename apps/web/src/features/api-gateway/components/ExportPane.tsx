import { REST_API_EXPORT_FORMATS, type RestApiExportFormat } from "@faws/contracts";
import { byteSize } from "@faws/shared";
import { useQuery } from "@tanstack/react-query";
import { FileJson, Layers } from "lucide-react";

import { Segmented } from "~/components/segmented";
import { CopyButton } from "~/components/ui/copy-button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { LoadingRows, Spinner } from "~/components/ui/spinner";
import { useAwsScope } from "~/contexts/ScopeContext";
import { JsonText } from "~/features/api-gateway/components/JsonText";
import { useSearchState } from "~/hooks/useSearchState";
import { trpc } from "~/lib/trpc";

const FORMAT_LABELS: Record<RestApiExportFormat, string> = {
  oas30: "OpenAPI 3",
  swagger: "Swagger 2",
};

/**
 * One stage's API definition as AWS exports it. The stage is the same URL
 * param the stages tab picks with, so moving between the two keeps it.
 */
export function ExportPane({ apiId }: { apiId: string }) {
  const scope = useAwsScope();
  const [picked, setPicked] = useSearchState<string>({
    key: "stage",
    fallback: "",
    parse: (raw) => (typeof raw === "string" ? raw : ""),
  });
  const [format, setFormat] = useSearchState<RestApiExportFormat>({
    key: "format",
    fallback: "oas30",
    parse: (raw) => REST_API_EXPORT_FORMATS.find((value) => value === raw) ?? "oas30",
  });

  const stages = useQuery(trpc.apiGateway.stages.queryOptions({ ...scope, apiId }));
  const stageName =
    stages.data?.find((stage) => stage.name === picked)?.name ?? stages.data?.[0]?.name ?? "";
  const exported = useQuery({
    ...trpc.apiGateway.export.queryOptions({ ...scope, apiId, stageName, format }),
    enabled: stageName !== "",
  });

  if (stages.isPending) return <LoadingRows rows={8} />;
  if (stages.isError) {
    return <ErrorState error={stages.error} onRetry={() => void stages.refetch()} />;
  }
  if (stages.data.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="Nothing to export"
        hint="A definition is exported from a stage, and this API has none."
      />
    );
  }

  const body = exported.data?.body ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-2">
        <select
          value={stageName}
          onChange={(event) => setPicked(event.target.value)}
          aria-label="Stage"
          className="h-7 max-w-48 min-w-0 cursor-pointer truncate rounded-md border border-border bg-transparent px-2 font-mono text-[12px] focus:outline-none"
        >
          {stages.data.map((stage) => (
            <option key={stage.name} value={stage.name}>
              {stage.name}
            </option>
          ))}
        </select>
        <Segmented<RestApiExportFormat>
          value={format}
          onChange={setFormat}
          options={REST_API_EXPORT_FORMATS.map((value) => ({
            value,
            label: FORMAT_LABELS[value],
          }))}
        />
        {exported.isFetching ? <Spinner /> : null}
        <div className="ml-auto flex items-center gap-2">
          {exported.data ? (
            <span className="font-mono text-[11px] text-muted-foreground tabular">
              {byteSize(exported.data.bytes)}
            </span>
          ) : null}
          {body !== null ? (
            <CopyButton variant="ghost" size="icon" label="definition" value={body} />
          ) : null}
        </div>
      </div>

      <div className="min-h-64 flex-1">
        {exported.isPending ? (
          <LoadingRows rows={8} />
        ) : exported.isError ? (
          <ErrorState error={exported.error} onRetry={() => void exported.refetch()} />
        ) : body === null ? (
          <EmptyState
            icon={FileJson}
            title="Too large to show here"
            hint={`The ${FORMAT_LABELS[format]} definition of ${stageName} is ${byteSize(exported.data.bytes)}; export it from the AWS console or CLI instead.`}
          />
        ) : (
          <JsonText key={`${stageName} ${format}`} text={body} />
        )}
      </div>
    </div>
  );
}
