import { ConnectionsList } from "~/features/s3/components/ConnectionsList";

/**
 * Where the S3 endpoints live.
 *
 * They used to be a panel three quarters of the way down Settings, which is
 * where a preference goes, not where the thing that decides which storage
 * system every S3 page is reading goes. It is part of S3, so it is a section
 * of S3 - with a row in the sidebar, a crumb of its own and a card on the
 * front door, none of which Settings could give it.
 *
 * Nothing about how an endpoint is stored moved with it: the record is still
 * saved through `trpc.s3Connections.save` into the broadcast settings file,
 * and the keys it signs with still live only in the machine's credential
 * store.
 */
export function ConnectionsPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <ConnectionsList />
    </div>
  );
}
