import { byteSize, joinKey } from "@faws/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Upload, X } from "lucide-react";
import * as React from "react";

import { Segmented } from "~/components/segmented";
import { Button } from "~/components/ui/button";
import { useAwsScope } from "~/contexts/ScopeContext";
import { trpcClient } from "~/lib/trpc";
import { uploadFile, type UploadHandle, type UploadTransport } from "~/lib/s3-upload";
import { cn } from "~/lib/utils";

interface Transfer {
  readonly name: string;
  sent: number;
  total: number;
  error: string | null;
  handle: UploadHandle | null;
}

/**
 * Files dropped onto the listing.
 *
 * The drop target is the whole pane rather than a button, because the gesture
 * people arrive with is dragging onto the folder they are looking at; the
 * button is there for the keyboard.
 */
export function UploadDropzone({
  bucket,
  prefix,
  children,
}: {
  bucket: string;
  prefix: string;
  /** Handed the picker and the transport switch, for its own toolbar. */
  children: (controls: { pickFiles: () => void; transport: React.ReactNode }) => React.ReactNode;
}) {
  const scope = useAwsScope();
  const queryClient = useQueryClient();
  const [over, setOver] = React.useState(false);
  const [transport, setTransport] = React.useState<UploadTransport>("proxy");
  const [transfers, setTransfers] = React.useState<ReadonlyArray<Transfer>>([]);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const send = React.useCallback(
    async (files: ReadonlyArray<File>) => {
      for (const file of files) {
        const entry: Transfer = {
          name: file.name,
          sent: 0,
          total: file.size,
          error: null,
          handle: null,
        };
        setTransfers((prev) => [...prev, entry]);

        const update = (patch: Partial<Transfer>) =>
          setTransfers((prev) =>
            prev.map((candidate) =>
              candidate === entry ? Object.assign({ ...candidate }, patch) : candidate,
            ),
          );

        try {
          const opened = await trpcClient.s3Actions.createUpload.mutate({
            ...scope,
            bucket,
            key: joinKey(prefix, file.name),
            size: file.size,
            contentType: file.type || "application/octet-stream",
            overwrite: false,
            transport,
          });

          const handle = uploadFile({
            file,
            uploadToken: opened.uploadToken,
            multipart: opened.multipart,
            transport: opened.transport,
            url: opened.url,
            overwrite: false,
            onProgress: (progress) => update({ sent: progress.sent }),
          });
          update({ handle });
          await handle.promise;
          update({ sent: file.size });
          void queryClient.invalidateQueries();
        } catch (err) {
          update({ error: err instanceof Error ? err.message : String(err) });
        }
      }
    },
    [scope, bucket, prefix, queryClient, transport],
  );

  // Handed to the toolbar rather than read here: the ref is only touched when
  // the button is pressed, which is an event and not a render.
  const openPicker = React.useCallback(() => fileInput.current?.click(), []);

  const active = transfers.filter(
    (transfer) => transfer.error === null && transfer.sent < transfer.total,
  );

  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col", over && "outline-2 outline-primary/60")}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        // Only the crossing that leaves the pane itself counts; moving between
        // rows inside it fires the same event.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const files = [...event.dataTransfer.files];
        if (files.length > 0) void send(files);
      }}
    >
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          // Clearing lets the same file be chosen twice in a row.
          event.target.value = "";
          if (files.length > 0) void send(files);
        }}
      />

      {/* The picker is passed down, not called: it reaches the ref only when
          the button it ends up on is pressed. */}
      {/* oxlint-disable-next-line react/refs */}
      {children({
        pickFiles: openPicker,
        transport: <TransportChoice value={transport} onChange={setTransport} />,
      })}

      {transfers.length > 0 ? (
        <div className="shrink-0 border-t border-border">
          {transfers.map((transfer, index) => (
            <div
              // oxlint-disable-next-line react/no-array-index-key
              key={`${transfer.name}:${index}`}
              className="flex items-center gap-2 px-3 py-1 font-mono text-[10.5px]"
            >
              <span className="w-48 truncate" title={transfer.name}>
                {transfer.name}
              </span>
              {transfer.error ? (
                <span className="text-danger">{transfer.error}</span>
              ) : (
                <>
                  <span className="h-1 w-40 overflow-hidden rounded bg-muted">
                    <span
                      className="block h-full bg-primary transition-[width]"
                      style={{
                        width: `${Math.round((transfer.sent / Math.max(1, transfer.total)) * 100)}%`,
                      }}
                    />
                  </span>
                  <span className="tabular text-muted-foreground">
                    {byteSize(transfer.sent)} / {byteSize(transfer.total)}
                  </span>
                </>
              )}
              {transfer.handle && transfer.sent < transfer.total && !transfer.error ? (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Cancel ${transfer.name}`}
                  onClick={() => transfer.handle?.cancel()}
                >
                  <X className="size-3" />
                </Button>
              ) : null}
            </div>
          ))}
          {active.length === 0 ? (
            <button
              type="button"
              onClick={() => setTransfers([])}
              className="cursor-pointer px-3 py-1 font-mono text-[10px] text-muted-foreground hover:text-foreground"
            >
              Clear finished
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The toolbar half of the dropzone. */
export function UploadButton({ onPick }: { onPick: () => void }) {
  return (
    <Button size="sm" onClick={onPick}>
      <Upload className="size-3" /> Upload
    </Button>
  );
}

/**
 * Which way the bytes go.
 *
 * Through the server by default, which keeps every credential on that side.
 * Direct writes to S3 are faster and cost this process nothing, but the signed
 * URL is a grant of the caller's own rights living in the page, and S3 will
 * only accept the write if the bucket's CORS policy names this origin.
 */
export function TransportChoice({
  value,
  onChange,
}: {
  value: UploadTransport;
  onChange: (next: UploadTransport) => void;
}) {
  return (
    <span className="flex items-center gap-2">
      <Segmented
        options={[
          { value: "proxy" as const, label: "via server" },
          { value: "presigned" as const, label: "direct" },
        ]}
        value={value}
        onChange={onChange}
      />
      <span className="font-mono text-[10px] text-muted-foreground">
        {value === "proxy"
          ? "credentials stay on the server"
          : "needs the bucket to allow this origin"}
      </span>
    </span>
  );
}
