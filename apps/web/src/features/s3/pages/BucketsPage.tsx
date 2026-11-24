import { useNavigate } from "@tanstack/react-router";

import { BucketList } from "~/capabilities/object-storage/BucketList";
import { StorageConnectionProvider } from "~/capabilities/object-storage/connection";
import { ConnectionPicker } from "~/features/s3/components/ConnectionPicker";
import { useS3Connection } from "~/features/s3/useS3Connection";

/** Every bucket on AWS, or on the saved endpoint the URL names. */
export function BucketsPage() {
  const { connection, endpointId } = useS3Connection();
  const navigate = useNavigate();

  return (
    <StorageConnectionProvider connection={connection}>
      <BucketList
        toolbar={<ConnectionPicker />}
        onOpen={(bucket) =>
          void navigate({
            to: "/s3/buckets/$bucket",
            params: { bucket },
            search: endpointId ? { connection: endpointId } : {},
          })
        }
      />
    </StorageConnectionProvider>
  );
}
