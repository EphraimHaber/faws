import { defineProvider } from "@faws/kit";

/**
 * S3-compatible object storage that is not AWS: MinIO, Ceph, Garage, a NAS.
 *
 * Its connections are saved endpoints rather than something discovered on
 * disk, often on a network with its own certificate authority.
 */
export const s3compatManifest = defineProvider({
  id: "s3",
  label: "Storage endpoints",
  description: "S3-compatible storage on your own network",
  icon: "warehouse",
  order: 30,
  defaultEnabled: true,
  capabilities: ["objectStorage"],
  runtimeDefaults: {},
  services: [
    {
      id: "s3-endpoints",
      label: "Endpoints",
      description: "Saved S3-compatible endpoints, their credentials and certificates",
      icon: "plug",
      status: "available",
      basePath: "/s3/connections",
      sections: [],
    },
  ],
});
