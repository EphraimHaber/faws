import { ConnectionsList } from "~/features/s3/components/ConnectionsList";

/**
 * Where the S3 endpoints live.
 *
 * A section of S3 rather than a panel in Settings: Settings is where a
 * preference goes, not the thing that decides which storage system every S3
 * page is reading. As a section it gets a row in the sidebar, a crumb of its
 * own and a card on the front door, none of which Settings could give it.
 *
 * The record is saved through `trpc.s3Connections.save` into the broadcast
 * settings file; the keys it signs with live only in the machine's credential
 * store.
 */
export function ConnectionsPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <ConnectionsList />
    </div>
  );
}
