import type { S3Connection } from "@faws/contracts";
import { useMutation } from "@tanstack/react-query";
import { Plus, ShieldAlert } from "lucide-react";
import * as React from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { useScope } from "~/contexts/ScopeContext";
import { ConnectionDialog } from "~/features/s3/components/ConnectionDialog";
import { useS3Connections } from "~/features/s3/useS3Connections";
import { trpc } from "~/lib/trpc";

/**
 * The S3 endpoints this machine knows about.
 *
 * S3 is the one service that can be pointed somewhere other than AWS, because
 * its API is what on prem object storage implements. Everything a private one
 * needs that AWS does not - a URL, keys, a CA, a client certificate - is
 * described per endpoint here.
 */
export function ConnectionsPanel() {
  const { connectionId, setConnectionId } = useScope();
  const [editing, setEditing] = React.useState<S3Connection | null | "new">(null);

  // Saving and removing land in the settings snapshot, which every window is
  // already listening to, so neither needs a query to invalidate.
  const remove = useMutation(trpc.s3Connections.remove.mutationOptions());

  const rows = useS3Connections();

  return (
    <Panel className="shrink-0">
      <PanelHeader>
        <PanelTitle>S3 endpoints</PanelTitle>
        <span className="font-mono text-[11px] text-muted-foreground tabular">{rows.length}</span>
        <Button size="sm" className="ml-auto" onClick={() => setEditing("new")}>
          <Plus className="size-3" /> Add
        </Button>
      </PanelHeader>

      {rows.length === 0 ? (
        <p className="px-3.5 py-4 text-[12.5px] text-muted-foreground">
          S3 reads the account the current profile belongs to. Add an endpoint to browse an S3
          compatible server on your own network instead.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((connection) => (
            <li key={connection.id} className="flex items-center gap-3 px-3.5 py-2">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[12.5px]">{connection.name}</span>
                  {connection.id === connectionId ? <Badge tone="primary">in use</Badge> : null}
                  {connection.source === "environment" ? (
                    <Badge tone="neutral">environment</Badge>
                  ) : null}
                  {connection.tls.verify ? null : (
                    <Badge tone="warning">
                      <ShieldAlert className="size-3" strokeWidth={2} /> unverified
                    </Badge>
                  )}
                  {connection.tls.pinnedSha256 ? <Badge tone="info">pinned</Badge> : null}
                </span>
                <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                  {connection.endpoint} · {describeCredentials(connection)}
                </span>
              </span>

              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConnectionId(connection.id === connectionId ? "" : connection.id)}
              >
                {connection.id === connectionId ? "Leave" : "Use"}
              </Button>
              {/* An endpoint the environment set belongs to whoever started
                  the process: an edit here would last until the next restart
                  and then silently revert. */}
              <Button
                size="sm"
                variant="outline"
                disabled={connection.source === "environment"}
                title={
                  connection.source === "environment"
                    ? "Set by the environment this server was started with."
                    : undefined
                }
                onClick={() => setEditing(connection)}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={connection.source === "environment"}
                onClick={() => {
                  // The stored keys go with it, so the id in scope has to stop
                  // pointing at it in the same act.
                  if (connection.id === connectionId) setConnectionId("");
                  remove.mutate({ id: connection.id });
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {editing !== null ? (
        <ConnectionDialog
          connection={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Panel>
  );
}

function describeCredentials(connection: S3Connection): string {
  switch (connection.credentials.mode) {
    case "static":
      return connection.credentials.accessKeyId;
    case "aws-profile":
      return `profile ${connection.credentials.profile}`;
    default:
      return "anonymous";
  }
}
