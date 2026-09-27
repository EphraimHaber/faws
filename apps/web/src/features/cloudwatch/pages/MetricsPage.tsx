import {
  CLOUDWATCH_WINDOWS,
  type CloudWatchWindow,
  DEFAULT_CLOUDWATCH_WINDOW,
  type MetricDescriptor,
  windowLabel,
} from "@faws/contracts";
import { relativeTime } from "@faws/shared";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Gauge, X } from "lucide-react";
import * as React from "react";

import { type Column, DataTable } from "~/components/data-table";
import { MetricChart } from "~/components/metric-chart";
import { PinButton, pinColumn } from "~/components/PinButton";
import { SearchField } from "~/components/SearchField";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { LoadingRows, Spinner } from "~/components/ui/spinner";
import { TextAction } from "~/components/ui/text-action";
import { useAwsScope } from "~/contexts/ScopeContext";
import { WindowPicker } from "~/features/cloudwatch/components/LogWindow";
import { dimensionsLabel, formatterFor, metricKey } from "~/features/cloudwatch/metric-ref";
import { metricRef } from "~/features/cloudwatch/refs";
import { useFilterSearch, useSearchState } from "~/hooks/useSearchState";
import { fullTimestamp } from "~/lib/format";
import { trpc } from "~/lib/trpc";

/**
 * How long the filter holds still before it becomes a server search. On top of
 * the URL's own debounce: each change is a fresh walk of ListMetrics.
 */
const SEARCH_DEBOUNCE_MS = 400;

/**
 * A filtered listing keeps walking on its own until it has this many matches,
 * so a rare term does not leave an empty table with more pages unread.
 */
const AUTO_FILL_MATCHES = 100;

/**
 * Every metric the account has reported lately, and a chart of the one picked.
 *
 * Paged and searched on the server: the table holds the pages it has scrolled
 * through, and the filter box is sent to the server, which matches it as it
 * walks ListMetrics - so the search covers every metric in the account, not
 * only the ones already loaded. The table applies the same filter to what it
 * holds, so the rows narrow at once while the server catches up.
 *
 * The chart sits above the list rather than on a page of its own, so trying
 * the next dimension along is one row down rather than a trip back and forth.
 * The picked metric rides in the URL, which makes a chart a link.
 */
export function MetricsPage() {
  const scope = useAwsScope();
  const navigate = useNavigate();
  const [filter, setFilter] = useFilterSearch();
  const query = useDebounced(filter.trim(), SEARCH_DEBOUNCE_MS);
  const [namespace, setNamespace] = useSearchState<string>({
    key: "ns",
    fallback: "",
    parse: (raw) => (typeof raw === "string" ? raw : ""),
  });
  const search: { chart?: MetricDescriptor } = useSearch({ strict: false });
  const chart = search.chart ?? null;
  const setChart = (next: MetricDescriptor | null) =>
    void navigate({
      to: ".",
      search: ((prev: Record<string, unknown>) => {
        const { chart: _chart, ...rest } = prev;
        return next ? { ...rest, chart: next } : rest;
      }) as never,
      replace: true,
    });

  const listing = useInfiniteQuery({
    ...trpc.cloudwatch.metrics.infiniteQueryOptions(
      {
        ...scope,
        ...(namespace ? { namespace } : {}),
        ...(query ? { query } : {}),
      },
      { getNextPageParam: (last) => last.nextToken },
    ),
    // The app-wide refresh would re-walk every page scrolled through; the
    // metric list changes over hours, not seconds.
    staleTime: 5 * 60_000,
  });
  const rows = React.useMemo(
    () => listing.data?.pages.flatMap((page) => page.items) ?? [],
    [listing.data],
  );
  const scanned = listing.data?.pages.reduce((sum, page) => sum + page.scanned, 0) ?? 0;

  // A filter that matches little leaves the table short with more unread, and
  // an empty table never reaches its end to ask for the next page.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = listing;
  React.useEffect(() => {
    if (query && hasNextPage && !isFetchingNextPage && rows.length < AUTO_FILL_MATCHES) {
      void fetchNextPage();
    }
  }, [query, hasNextPage, isFetchingNextPage, rows.length, fetchNextPage]);

  // CloudWatch has no call that lists namespaces, so the picker offers every
  // namespace the unfiltered listing has paged through - read from the cache
  // without fetching, so a search does not shrink it to what matched - plus
  // what the current pages show.
  const unfiltered = useInfiniteQuery({
    ...trpc.cloudwatch.metrics.infiniteQueryOptions(scope, {
      getNextPageParam: (last) => last.nextToken,
    }),
    enabled: false,
  });
  const namespaces = React.useMemo(() => {
    const names = new Set(rows.map((row) => row.namespace));
    for (const page of unfiltered.data?.pages ?? []) {
      for (const item of page.items) names.add(item.namespace);
    }
    // A namespace from a link is offered even before a page has shown it.
    if (namespace) names.add(namespace);
    return [...names].toSorted();
  }, [rows, unfiltered.data, namespace]);

  const columns = React.useMemo<Column<MetricDescriptor>[]>(
    () => [
      {
        id: "namespace",
        header: "Namespace",
        width: "14rem",
        mono: true,
        value: (row) => row.namespace,
        cell: (row) => <span className="text-muted-foreground">{row.namespace}</span>,
      },
      {
        id: "metric",
        header: "Metric",
        width: "16rem",
        value: (row) => row.name,
        cell: (row) => <span className="font-medium">{row.name}</span>,
      },
      {
        id: "dimensions",
        header: "Dimensions",
        mono: true,
        value: (row) => dimensionsLabel(row),
        cell: (row) => (
          <span className="text-[11px] text-muted-foreground">{dimensionsLabel(row)}</span>
        ),
      },
      pinColumn((row) => metricRef(row, scope)),
    ],
    [scope],
  );

  const searching = listing.isFetching && query !== "";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {chart ? <ChartPanel metric={chart} onClose={() => setChart(null)} /> : null}

      <Panel className="flex-1">
        <PanelHeader>
          <PanelTitle>Metrics</PanelTitle>
          <span className="font-mono text-[11px] text-muted-foreground tabular">
            {listing.isPending ? "…" : `${rows.length}${listing.hasNextPage ? "+" : ""}`}
          </span>
          {query ? (
            <span className="flex items-center gap-1.5 font-mono text-[10.5px] whitespace-nowrap text-muted-foreground">
              {searching ? <Spinner className="size-3" /> : null}
              {scanned.toLocaleString()} searched
            </span>
          ) : null}
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <select
              value={namespace}
              onChange={(event) => setNamespace(event.target.value)}
              aria-label="Namespace"
              title="Namespaces seen so far; every metric is searched whichever is picked"
              className="h-7 max-w-48 min-w-0 cursor-pointer truncate rounded-md border border-border bg-transparent px-2 text-[12px] focus:outline-none"
            >
              <option value="">Every namespace</option>
              {namespaces.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            {/* The remote surface, not the table's own filter: this box is
                sent to the server and searches metrics nobody has loaded. */}
            <SearchField
              surface="remote"
              label="every metric"
              hotkey
              showShape={false}
              value={filter}
              onChange={setFilter}
              placeholder="Search… (try metric:cpu)"
            />
          </div>
        </PanelHeader>

        {listing.isError ? (
          <ErrorState error={listing.error} onRetry={() => void listing.refetch()} />
        ) : listing.isPending ? (
          <LoadingRows />
        ) : (
          <DataTable
            tableId="cloudwatch-metrics"
            rows={rows}
            columns={columns}
            rowKey={metricKey}
            filter={filter}
            onClearFilter={() => setFilter("")}
            onOpen={setChart}
            onEndReached={() => {
              if (listing.hasNextPage && !listing.isFetchingNextPage) {
                void listing.fetchNextPage();
              }
            }}
            footer={
              <p className="flex items-center gap-2 border-t border-border px-3 py-1 font-mono text-[10px] text-muted-foreground">
                {listing.isFetchingNextPage ? <Spinner className="size-3" /> : null}
                {query
                  ? `${rows.length} matched of ${scanned.toLocaleString()} searched`
                  : `${rows.length} loaded`}
                {listing.hasNextPage ? (
                  <>
                    , more below
                    {!listing.isFetchingNextPage ? (
                      <TextAction onClick={() => void listing.fetchNextPage()}>
                        load more
                      </TextAction>
                    ) : null}
                  </>
                ) : (
                  ", that is all of them"
                )}
              </p>
            }
            emptyState={
              listing.hasNextPage || listing.isFetchingNextPage ? (
                <EmptyState icon={Gauge} title="Searching…" hint={`${scanned} metrics so far`} />
              ) : (
                <EmptyState
                  icon={Gauge}
                  title={query ? "No metric matches" : "No metrics"}
                  hint={
                    query
                      ? `Searched all ${scanned.toLocaleString()} metrics${namespace ? ` in ${namespace}` : ""}.`
                      : "Nothing has reported in the last two weeks, or the profile cannot list metrics."
                  }
                />
              )
            }
          />
        )}
      </Panel>
    </div>
  );
}

/** `value`, once it has held still for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** The smallest window that reaches back to `iso`, or null if none does. */
function windowReaching(iso: string): CloudWatchWindow | null {
  const ageMinutes = (Date.now() - Date.parse(iso)) / 60_000;
  return CLOUDWATCH_WINDOWS.find((minutes) => minutes >= ageMinutes) ?? null;
}

/** Average and maximum of the picked metric, over a window that ends now. */
function ChartPanel({ metric, onClose }: { metric: MetricDescriptor; onClose: () => void }) {
  const scope = useAwsScope();
  const [windowMinutes, setWindowMinutes] = useSearchState<CloudWatchWindow>({
    key: "window",
    fallback: DEFAULT_CLOUDWATCH_WINDOW,
    parse: (raw) =>
      CLOUDWATCH_WINDOWS.find((minutes) => minutes === Number(raw)) ?? DEFAULT_CLOUDWATCH_WINDOW,
  });

  const series = useQuery(
    trpc.cloudwatch.metricSeries.queryOptions({
      ...scope,
      namespace: metric.namespace,
      metricName: metric.name,
      dimensions: [...metric.dimensions],
      windowMinutes,
    }),
  );
  const format = formatterFor(series.data?.unit);
  const target = React.useMemo(() => metricRef(metric, scope), [metric, scope]);

  const last = series.data?.lastDatapointAt ?? null;
  const reach = last ? windowReaching(last) : null;

  return (
    <Panel className="shrink-0">
      <PanelHeader>
        <PanelTitle className="truncate">{metric.name}</PanelTitle>
        <span className="truncate font-mono text-[10.5px] text-muted-foreground">
          {metric.namespace} · {dimensionsLabel(metric)}
        </span>
        <PinButton target={target} />
        {series.isFetching ? <Spinner /> : null}
        <div className="ml-auto flex items-center gap-2">
          <WindowPicker value={windowMinutes} onChange={setWindowMinutes} />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close the chart"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </PanelHeader>
      <div className="p-3">
        {series.isError ? (
          <ErrorState error={series.error} onRetry={() => void series.refetch()} />
        ) : series.isPending ? (
          <div className="flex h-44 items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <MetricChart
            series={series.data}
            label={series.data.unit && series.data.unit !== "None" ? series.data.unit : "Metric"}
            format={format}
            axis={series.data.unit === "Percent" ? "percent" : "auto"}
            peakFloor={series.data.unit === "Percent" ? 10 : 0}
            height={160}
            empty={
              <>
                <span>
                  Nothing reported in the last {windowLabel(windowMinutes)}.
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
                    " Nothing in the last 15 days either."
                  )}
                </span>
                {reach && reach !== windowMinutes ? (
                  <Button type="button" variant="outline" onClick={() => setWindowMinutes(reach)}>
                    Show the last {windowLabel(reach)}
                  </Button>
                ) : null}
              </>
            }
          />
        )}
      </div>
    </Panel>
  );
}
