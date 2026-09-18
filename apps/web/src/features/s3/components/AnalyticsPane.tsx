import type { S3PrefixRollup } from "@faws/contracts";
import { byteSize } from "@faws/shared";
import { useQuery } from "@tanstack/react-query";
import { Ruler, Square } from "lucide-react";
import * as React from "react";

import { MetricChart } from "~/components/metric-chart";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { Spinner } from "~/components/ui/spinner";
import { useS3Scope } from "~/contexts/ScopeContext";
import { useS3Capabilities } from "~/features/s3/useS3Capabilities";
import { startScan, type RunningScan } from "~/lib/s3-scan";
import { trpc } from "~/lib/trpc";
import { cn } from "~/lib/utils";

/** The same ceilings the search uses; a rollup is the same walk. */
const MAX_OBJECTS = 200_000;
const MAX_SECONDS = 120;

/**
 * What the bucket holds, from two directions.
 *
 * CloudWatch answers "how has it grown" for free but only once a day.
 * Measuring a prefix answers "what is in it now", and costs a request per
 * thousand keys, so it is something you ask for rather than something that
 * happens on open.
 */
export function AnalyticsPane({ bucket, prefix }: { bucket: string; prefix: string }) {
  const scope = useS3Scope();
  const capabilities = useS3Capabilities();

  const metrics = useQuery({
    ...trpc.s3.storageMetrics.queryOptions({ ...scope, bucket, days: 30 }),
    staleTime: 60 * 60_000,
    enabled: capabilities.storageMetrics,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
      <PrefixSize bucket={bucket} prefix={prefix} />

      <Panel className="shrink-0">
        <PanelHeader>
          <PanelTitle>Daily, from CloudWatch</PanelTitle>
          <span className="font-mono text-[10.5px] text-muted-foreground">
            published once a day, so today is usually missing
          </span>
        </PanelHeader>

        {!capabilities.storageMetrics ? (
          <p className="px-3.5 py-4 text-[12.5px] text-muted-foreground">
            This endpoint publishes no daily metrics. Measuring the prefix above is the way to a
            size here.
          </p>
        ) : metrics.isPending ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        ) : metrics.isError ? (
          <ErrorState error={metrics.error} onRetry={() => void metrics.refetch()} />
        ) : (
          <div className="grid gap-3 p-3 lg:grid-cols-2">
            {metrics.data.map((series) => (
              <MetricChart
                key={series.metric}
                series={series}
                label={series.metric === "BucketSizeBytes" ? "Size" : "Objects"}
                format={
                  series.metric === "BucketSizeBytes"
                    ? (value) => (value === null ? "-" : byteSize(value))
                    : (value) => (value === null ? "-" : Math.round(value).toLocaleString())
                }
                peakFloor={1}
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/**
 * Count and size under the open prefix, measured on request.
 *
 * It rides the same streamed walk the search uses, so a large prefix reports
 * as it goes and can be stopped.
 */
function PrefixSize({ bucket, prefix }: { bucket: string; prefix: string }) {
  const scope = useS3Scope();
  const [rollup, setRollup] = React.useState<S3PrefixRollup | null>(null);
  const [scanned, setScanned] = React.useState<{ objects: number; bytes: number } | null>(null);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const handle = React.useRef<RunningScan | null>(null);

  React.useEffect(() => {
    return () => handle.current?.cancel();
  }, []);

  const measure = () => {
    handle.current?.cancel();
    setRollup(null);
    setScanned(null);
    setError(null);
    setRunning(true);

    handle.current = startScan(
      {
        scanId: crypto.randomUUID(),
        profile: scope.profile,
        region: scope.region,
        ...(scope.connectionId ? { connectionId: scope.connectionId } : {}),
        bucket,
        prefix,
        maxObjects: MAX_OBJECTS,
        maxSeconds: MAX_SECONDS,
      },
      {
        onChunk: () => undefined,
        onProgress: (progress) => setScanned({ objects: progress.scanned, bytes: progress.bytes }),
        onDone: (progress, done) => {
          handle.current = null;
          setRunning(false);
          setScanned({ objects: progress.scanned, bytes: progress.bytes });
          setRollup(done);
        },
        onError: (message) => {
          handle.current = null;
          setRunning(false);
          setError(message);
        },
      },
    );
  };

  const classes = Object.entries(rollup?.byStorageClass ?? {}).toSorted((a, b) => b[1] - a[1]);

  return (
    <Panel className="shrink-0">
      <PanelHeader>
        <PanelTitle>This prefix</PanelTitle>
        <span className="font-mono text-[11px] text-muted-foreground">{prefix || "/"}</span>
        <span className="ml-auto">
          {running ? (
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                handle.current?.cancel();
                handle.current = null;
                setRunning(false);
              }}
            >
              <Square className="size-3" /> Stop
            </Button>
          ) : (
            <Button size="sm" onClick={measure}>
              <Ruler className="size-3" /> Measure
            </Button>
          )}
        </span>
      </PanelHeader>

      {error ? (
        <p className="px-3.5 py-3 text-[12px] text-danger">{error}</p>
      ) : scanned === null ? (
        <EmptyState
          icon={Ruler}
          title="Not measured"
          hint="Counting a prefix reads every key under it, so it is asked for rather than assumed."
        />
      ) : (
        <div className="flex flex-col gap-2 px-3.5 py-3">
          <div className="flex items-baseline gap-4">
            <span className="font-mono text-[22px] leading-none tabular">
              {byteSize(scanned.bytes)}
            </span>
            <span className="font-mono text-[12px] text-muted-foreground tabular">
              {scanned.objects.toLocaleString()} objects
            </span>
            {running ? <Spinner className="size-3" /> : null}
          </div>

          {classes.length > 0 ? (
            <div className="flex flex-col gap-1">
              {classes.map(([name, bytes]) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="w-40 truncate font-mono text-[10.5px] text-muted-foreground">
                    {name}
                  </span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
                    <span
                      className={cn("block h-full bg-primary")}
                      style={{
                        width: `${Math.round((bytes / Math.max(1, scanned.bytes)) * 100)}%`,
                      }}
                    />
                  </span>
                  <span className="w-24 text-right font-mono text-[10.5px] tabular">
                    {byteSize(bytes)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
