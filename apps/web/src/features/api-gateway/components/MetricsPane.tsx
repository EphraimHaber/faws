import {
  CLOUDWATCH_WINDOWS,
  type CloudWatchWindow,
  DEFAULT_CLOUDWATCH_WINDOW,
  type MetricDimension,
  periodFor,
  windowLabel,
} from "@faws/contracts";
import { relativeTime } from "@faws/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";

import { MetricChart } from "~/components/metric-chart";
import { RefreshControl } from "~/components/refresh";
import { Button } from "~/components/ui/button";
import { ErrorState } from "~/components/ui/error-state";
import { LoadingRows, Spinner } from "~/components/ui/spinner";
import { TextAction } from "~/components/ui/text-action";
import { useAwsScope } from "~/stores/scope";
import { StageSelect } from "~/features/api-gateway/components/parts";
import {
  API_GATEWAY_NAMESPACE,
  periodLabel,
  REST_API_METRICS,
  type RestApiMetric,
  restApiDimensions,
} from "~/features/api-gateway/metrics";
import { WindowPicker } from "~/features/cloudwatch/components/LogWindow";
import { chartStatistics, formatterFor, windowReaching } from "~/features/cloudwatch/metric-ref";
import { parseText, useSearchState } from "~/hooks/useSearchState";
import { fullTimestamp } from "~/lib/format";
import { trpc } from "~/lib/trpc";

/**
 * What CloudWatch has on the API: traffic, errors, latency and cache use, for
 * every stage together or one stage alone. The stage is picked by the `stage`
 * URL param; absent, it is every stage.
 */
export function MetricsPane({ apiId, apiName }: { apiId: string; apiName: string }) {
  const scope = useAwsScope();
  const [picked, setPicked] = useSearchState<string>({
    key: "stage",
    fallback: "",
    parse: parseText,
  });
  const [windowMinutes, setWindowMinutes] = useSearchState<CloudWatchWindow>({
    key: "window",
    fallback: DEFAULT_CLOUDWATCH_WINDOW,
    parse: (raw) =>
      CLOUDWATCH_WINDOWS.find((minutes) => minutes === Number(raw)) ?? DEFAULT_CLOUDWATCH_WINDOW,
  });

  const stages = useQuery(trpc.apiGateway.stages.queryOptions({ ...scope, apiId }));
  // A stage from a link that the API no longer has reads as every stage,
  // rather than as charts of a dimension nothing reports under. Without a
  // stage list to check against, the linked stage is charted as it is.
  const stageName = stages.isError
    ? picked || null
    : (stages.data?.find((stage) => stage.name === picked)?.name ?? null);
  const stageNames = stages.data?.map((stage) => stage.name) ?? (stageName ? [stageName] : []);
  const dimensions = restApiDimensions(apiName, stageName);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-2">
        <StageSelect
          value={stageName ?? ""}
          names={stageNames}
          onChange={setPicked}
          allLabel="All stages"
        />
        {stages.isError ? (
          <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-danger">
            <span title={stages.error.message}>stages could not be read</span>
            <TextAction onClick={() => void stages.refetch()}>retry</TextAction>
          </span>
        ) : null}
        <WindowPicker value={windowMinutes} onChange={setWindowMinutes} />
        <span
          className="ml-auto truncate font-mono text-[10.5px] text-muted-foreground"
          title="CloudWatch keys these by the API's name, so another API with the same name in this region is counted here too."
        >
          {API_GATEWAY_NAMESPACE} ·{" "}
          {dimensions.map((dimension) => `${dimension.name}=${dimension.value}`).join(", ")} · per{" "}
          {periodLabel(periodFor(windowMinutes))}
        </span>
      </div>

      {picked && stages.isPending ? (
        // Until the stages load, a linked stage cannot be told from a stale
        // one, and charting every stage meanwhile would be read twice.
        <LoadingRows rows={8} />
      ) : (
        <div className="grid gap-4 overflow-auto p-4 lg:grid-cols-2">
          {REST_API_METRICS.map((chart) => (
            <RestApiMetricChart
              key={chart.metric}
              chart={chart}
              dimensions={dimensions}
              windowMinutes={windowMinutes}
              onWindow={setWindowMinutes}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** One metric's chart, with a way to open it on the CloudWatch metrics page. */
function RestApiMetricChart({
  chart,
  dimensions,
  windowMinutes,
  onWindow,
}: {
  chart: RestApiMetric;
  dimensions: MetricDimension[];
  windowMinutes: CloudWatchWindow;
  onWindow: (next: CloudWatchWindow) => void;
}) {
  const scope = useAwsScope();
  const series = useQuery(
    trpc.cloudwatch.metricSeries.queryOptions({
      ...scope,
      namespace: API_GATEWAY_NAMESPACE,
      metricName: chart.metric,
      dimensions,
      windowMinutes,
      statistic: chart.statistic,
    }),
  );

  const last = series.data?.lastDatapointAt ?? null;
  const reach = last ? windowReaching(last) : null;

  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      {series.isError ? (
        <ErrorState error={series.error} onRetry={() => void series.refetch()} />
      ) : series.isPending ? (
        <div className="flex h-[184px] items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <MetricChart
          series={series.data}
          label={chart.label}
          format={formatterFor(series.data.unit)}
          statistics={chartStatistics(chart.statistic)}
          axis="auto"
          peakFloor={0}
          height={160}
          empty={
            <>
              <span className="px-3 text-center">
                No {chart.label.toLowerCase()} in the last {windowLabel(windowMinutes)}.
                {last ? (
                  <>
                    {" "}
                    Last datapoint{" "}
                    <span className="text-foreground" title={fullTimestamp(last)}>
                      {relativeTime(last)}
                    </span>
                    .
                  </>
                ) : (
                  ` ${chart.hint ?? "Nothing in the last 15 days either."}`
                )}
              </span>
              {reach && reach !== windowMinutes ? (
                <Button type="button" variant="outline" onClick={() => onWindow(reach)}>
                  Show the last {windowLabel(reach)}
                </Button>
              ) : null}
            </>
          }
        />
      )}
      <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
        <span>{chart.metric}</span>
        <Link
          to="/cloudwatch/metrics"
          search={{
            ns: API_GATEWAY_NAMESPACE,
            chart: { namespace: API_GATEWAY_NAMESPACE, name: chart.metric, dimensions },
            window: windowMinutes,
            stat: chart.statistic,
          }}
          className="ml-auto inline-flex items-center gap-1 underline decoration-border underline-offset-2 hover:text-primary"
        >
          In CloudWatch <ArrowUpRight className="size-3" />
        </Link>
        <RefreshControl source={series} label="Refresh chart" />
      </div>
    </section>
  );
}
