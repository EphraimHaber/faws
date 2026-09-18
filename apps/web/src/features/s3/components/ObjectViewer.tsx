import type { S3ObjectHead } from "@faws/contracts";
import { byteSize, relativeTime } from "@faws/shared";
import { useQuery } from "@tanstack/react-query";
import { Archive, Binary, Copy, Download, FileQuestion, Tag, X } from "lucide-react";
import * as React from "react";

import { JsonViewer } from "~/components/JsonViewer";
import { CopyMoveDialog } from "~/features/s3/components/CopyMoveDialog";
import { TagEditor } from "~/features/s3/components/TagEditor";
import { HexViewer } from "~/features/s3/viewers/HexViewer";
import {
  AudioViewer,
  ImageViewer,
  PdfViewer,
  VideoViewer,
} from "~/features/s3/viewers/MediaViewer";
import { HEAD_SLICE, planFor } from "~/features/s3/viewers/plan";
import { TableViewer } from "~/features/s3/viewers/TableViewer";
import { TextViewer } from "~/features/s3/viewers/TextViewer";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { CopyButton } from "~/components/ui/copy-button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { Spinner } from "~/components/ui/spinner";
import { useS3Scope } from "~/contexts/ScopeContext";
import { fullTimestamp } from "~/lib/format";
import { downloadObject, fetchRange, fetchText, objectUrl } from "~/lib/s3-bytes";
import { trpc } from "~/lib/trpc";

/** How much of a refused object the hex fallback shows. */
const HEX_BYTES = 4096;

export function ObjectViewer({
  bucket,
  objectKey,
  onClose,
}: {
  bucket: string;
  objectKey: string;
  onClose: () => void;
}) {
  const scope = useS3Scope();
  const [dialog, setDialog] = React.useState<"copy" | "tags" | null>(null);
  const writeMode = useQuery(trpc.aws.writeMode.queryOptions());
  const canWrite = writeMode.data ? !writeMode.data.readOnly : false;

  const head = useQuery({
    ...trpc.s3.head.queryOptions({ ...scope, bucket, key: objectKey }),
    staleTime: 60_000,
  });

  return (
    <Panel className="min-h-0 flex-1">
      <PanelHeader className="gap-2">
        <PanelTitle className="shrink-0">Object</PanelTitle>
        <span className="truncate font-mono text-[11.5px]" title={objectKey}>
          {objectKey}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {head.data ? <Badge>{head.data.openAs}</Badge> : null}
          <CopyButton size="icon" variant="ghost" value={objectKey} label="Copy key" />
          {canWrite ? (
            <>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Copy or move"
                onClick={() => setDialog("copy")}
              >
                <Copy className="size-3" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Edit tags"
                onClick={() => setDialog("tags")}
              >
                <Tag className="size-3" />
              </Button>
            </>
          ) : null}
          <Button
            size="icon"
            variant="ghost"
            aria-label="Download"
            onClick={() => downloadObject(scope, { bucket, key: objectKey })}
          >
            <Download className="size-3" />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Close" onClick={onClose}>
            <X className="size-3" />
          </Button>
        </div>
      </PanelHeader>

      {head.isPending ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : head.isError ? (
        <ErrorState error={head.error} onRetry={() => void head.refetch()} />
      ) : head.data === null ? (
        <EmptyState
          icon={FileQuestion}
          title="No such object"
          hint="It may have been deleted since this prefix was listed."
        />
      ) : (
        <>
          <ObjectFacts head={head.data} />
          <ObjectBody head={head.data} />
        </>
      )}

      {dialog === "copy" ? (
        <CopyMoveDialog bucket={bucket} sourceKey={objectKey} onClose={() => setDialog(null)} />
      ) : null}

      {dialog === "tags" ? (
        <TagEditor
          bucket={bucket}
          objectKey={objectKey}
          // The head carries user metadata, not the tag set, which is its own
          // call; the editor starts from what is already known and the save
          // replaces whatever is there.
          tags={{}}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </Panel>
  );
}

function ObjectFacts({ head }: { head: S3ObjectHead }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-3.5 py-1.5 font-mono text-[10.5px] text-muted-foreground">
      <span className="tabular">{byteSize(head.size)}</span>
      <span title={fullTimestamp(head.lastModified)}>{relativeTime(head.lastModified)}</span>
      <span>{head.contentType ?? "no content type"}</span>
      {head.storageClass === "STANDARD" ? null : <span>{head.storageClass}</span>}
      {head.contentEncoding ? <span>{head.contentEncoding}</span> : null}
      {head.serverSideEncryption ? <span>{head.serverSideEncryption}</span> : null}
      {head.etag ? <span className="truncate">etag {head.etag}</span> : null}
      {head.versionId && head.versionId !== "null" ? (
        <span className="truncate">version {head.versionId}</span>
      ) : null}
      {Object.entries(head.metadata).map(([key, value]) => (
        // User metadata is whatever the uploader attached, so it is shown
        // beside the facts rather than behind another click.
        <span key={key} className="truncate">
          {key} {value}
        </span>
      ))}
    </div>
  );
}

function ObjectBody({ head }: { head: S3ObjectHead }) {
  const plan = planFor(head);

  if (plan.kind === "refuse") {
    return <RefusedObject head={head} reason={plan.reason} />;
  }
  if (plan.kind === "binary") {
    return <BinaryObject head={head} />;
  }
  if (plan.kind === "stream") {
    return <StreamedObject head={head} openAs={plan.openAs} />;
  }
  return (
    <TextualObject
      head={head}
      openAs={plan.openAs}
      {...(plan.kind === "slice" ? { sliceBytes: plan.bytes } : {})}
    />
  );
}

function StreamedObject({
  head,
  openAs,
}: {
  head: S3ObjectHead;
  openAs: "image" | "audio" | "video" | "pdf";
}) {
  const scope = useS3Scope();
  const url = objectUrl(scope, { bucket: head.bucket, key: head.key }, { disposition: "inline" });

  if (openAs === "image") return <ImageViewer url={url} alt={head.key} />;
  if (openAs === "audio") return <AudioViewer url={url} />;
  if (openAs === "video") return <VideoViewer url={url} />;
  return <PdfViewer url={url} title={head.key} />;
}

/**
 * Text, JSON and the tabular kinds, which are read into the page.
 *
 * A slice is fetched with its own query key, so asking for the whole object
 * afterwards does not throw away the part already on screen.
 */
function TextualObject({
  head,
  openAs,
  sliceBytes,
}: {
  head: S3ObjectHead;
  openAs: "text" | "json" | "jsonl" | "csv";
  sliceBytes?: number;
}) {
  const scope = useS3Scope();
  const [wholeAnyway, setWholeAnyway] = React.useState(false);
  const sliced = sliceBytes !== undefined && !wholeAnyway;

  const content = useQuery({
    queryKey: [
      "s3:content",
      scope.profile,
      scope.region,
      head.bucket,
      head.key,
      head.etag,
      sliced ? sliceBytes : "whole",
    ],
    queryFn: async ({ signal }) => {
      const ref = { bucket: head.bucket, key: head.key };
      if (!sliced) return fetchText(scope, ref, { signal });
      const range = await fetchRange(scope, ref, 0, sliceBytes ?? HEAD_SLICE, { signal });
      return new TextDecoder().decode(range.bytes);
    },
    staleTime: 5 * 60_000,
  });

  if (content.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (content.isError) {
    return <ErrorState error={content.error} onRetry={() => void content.refetch()} />;
  }

  const text = content.data;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {sliced ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-border bg-warning/8 px-3.5 py-1.5">
          <span className="text-[11.5px] text-foreground">
            Showing the first {byteSize(sliceBytes ?? HEAD_SLICE)} of {byteSize(head.size)}.
          </span>
          <Button size="sm" onClick={() => setWholeAnyway(true)}>
            Load the whole object
          </Button>
        </div>
      ) : null}

      {openAs === "json" ? (
        <JsonBody text={text} />
      ) : openAs === "csv" || openAs === "jsonl" ? (
        <TableViewer text={text} kind={openAs === "csv" ? "csv" : "jsonl"} />
      ) : (
        <TextViewer text={text} />
      )}
    </div>
  );
}

/**
 * JSON as a document when it parses, and as text when it does not.
 *
 * A truncated slice never parses, and an unreadable error is a worse answer
 * than the raw text with a note above it.
 */
function JsonBody({ text }: { text: string }) {
  const parsed = React.useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(text) as unknown };
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : String(err) };
    }
  }, [text]);

  if (parsed.ok) return <JsonViewer value={parsed.value} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="shrink-0 border-b border-border px-3.5 py-1.5 text-[11.5px] text-warning">
        Not valid JSON, showing the text as stored: {parsed.message}
      </p>
      <TextViewer text={text} />
    </div>
  );
}

/** Too large, or archived: the object is described rather than opened. */
function RefusedObject({ head, reason }: { head: S3ObjectHead; reason: "size" | "archived" }) {
  const scope = useS3Scope();
  const [showHex, setShowHex] = React.useState(false);

  if (reason === "archived") {
    return (
      <EmptyState
        icon={Archive}
        title={`Archived in ${head.storageClass}`}
        hint={
          head.restore
            ? "A restore is in progress; the bytes can be read once it finishes."
            : "The bytes need a restore before they can be read."
        }
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3.5 py-2">
        <span className="text-[12px]">{byteSize(head.size)} is too large to open in the page.</span>
        <Button size="sm" onClick={() => setShowHex((prev) => !prev)}>
          <Binary className="size-3" /> {showHex ? "Hide" : "Read the first"} {byteSize(HEX_BYTES)}
        </Button>
        <Button
          size="sm"
          onClick={() => downloadObject(scope, { bucket: head.bucket, key: head.key })}
        >
          <Download className="size-3" /> Download
        </Button>
      </div>
      {showHex ? <HeadBytes head={head} /> : null}
    </div>
  );
}

function BinaryObject({ head }: { head: S3ObjectHead }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="shrink-0 border-b border-border px-3.5 py-1.5 text-[11.5px] text-muted-foreground">
        Nothing here renders {head.contentType ?? "this type"}, so these are the bytes as stored.
      </p>
      <HeadBytes head={head} />
    </div>
  );
}

/** The leading bytes, read raw so a stored encoding is not inflated first. */
function HeadBytes({ head }: { head: S3ObjectHead }) {
  const scope = useS3Scope();
  const slice = useQuery({
    queryKey: ["s3:hex", scope.profile, scope.region, head.bucket, head.key, head.etag],
    queryFn: ({ signal }) =>
      fetchRange(
        scope,
        { bucket: head.bucket, key: head.key },
        0,
        Math.min(HEX_BYTES, Math.max(head.size, 1)),
        { raw: true, signal },
      ),
    staleTime: 5 * 60_000,
  });

  if (slice.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (slice.isError) {
    return <ErrorState error={slice.error} onRetry={() => void slice.refetch()} />;
  }
  return <HexViewer bytes={slice.data.bytes} />;
}
