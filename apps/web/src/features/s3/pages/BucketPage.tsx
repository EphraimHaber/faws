import { normalizePrefix } from "@faws/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";

import { ObjectBrowser } from "~/features/s3/components/ObjectBrowser";
import { ObjectViewer } from "~/features/s3/components/ObjectViewer";
import { Badge } from "~/components/ui/badge";
import { ErrorState } from "~/components/ui/error-state";
import { Panel } from "~/components/ui/panel";
import { useAwsScope, useScope } from "~/contexts/ScopeContext";
import { trpc } from "~/lib/trpc";

/**
 * One bucket, opened at a prefix.
 *
 * The region is resolved here because this is the first point at which it is
 * needed: every call against the objects inside is addressed to the bucket's
 * own region, which is not always the one the rest of the app is scoped to.
 */
export function BucketPage({ bucket }: { bucket: string }) {
  const scope = useAwsScope();
  const { region: scopeRegion } = useScope();
  const navigate = useNavigate();
  const { prefix = "", object } = useSearch({ from: "/s3/buckets/$bucket" });

  const region = useQuery({
    ...trpc.s3.bucketRegion.queryOptions({ ...scope, bucket }),
    staleTime: Infinity,
  });

  // Whether a delete here can be undone is part of what a confirmation has to
  // say, so it is read alongside the bucket rather than guessed at the dialog.
  const versioning = useQuery({
    ...trpc.s3.versioning.queryOptions({ ...scope, bucket }),
    staleTime: 5 * 60_000,
  });

  if (region.isError) {
    return (
      <Panel className="flex-1">
        <ErrorState error={region.error} onRetry={() => void region.refetch()} />
      </Panel>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {region.data && region.data !== scopeRegion ? (
        <div className="flex shrink-0 items-center gap-2 px-0.5">
          <Badge tone="info">{region.data}</Badge>
          <span className="text-[11.5px] text-muted-foreground">
            This bucket lives outside the region in scope; its objects are read from there.
          </span>
        </div>
      ) : null}

      {/* Side by side where there is room, and stacked where there is not:
          below about a thousand pixels two panes leave neither one wide enough
          to read a key in. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ObjectBrowser
            bucket={bucket}
            prefix={prefix}
            versioned={versioning.data ?? null}
            onNavigate={(next) => {
              const normalized = normalizePrefix(next);
              void navigate({
                to: "/s3/buckets/$bucket",
                params: { bucket },
                search: normalized.length > 0 ? { prefix: normalized } : {},
              });
            }}
            onOpenObject={(key) =>
              void navigate({
                to: "/s3/buckets/$bucket",
                params: { bucket },
                search: { ...(prefix.length > 0 ? { prefix } : {}), object: key },
                replace: true,
              })
            }
          />
        </div>

        {object ? (
          <div className="flex min-h-0 flex-1 flex-col lg:w-[46%] lg:min-w-[22rem] lg:flex-none">
            <ObjectViewer
              bucket={bucket}
              objectKey={object}
              onClose={() =>
                void navigate({
                  to: "/s3/buckets/$bucket",
                  params: { bucket },
                  search: prefix.length > 0 ? { prefix } : {},
                  replace: true,
                })
              }
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
