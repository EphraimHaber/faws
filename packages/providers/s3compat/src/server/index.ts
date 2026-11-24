/**
 * Saved S3-compatible endpoints on the server: the router that saves, tests
 * and removes them, their object storage port, and the store contract the
 * host fills in with where records and credentials are actually kept.
 */
export { s3ConnectionsRouter } from "./connections.router.ts";
export { registerS3compatObjectStorage, s3compatObjectStorage } from "./objectStorage.ts";
export {
  registerConnectionStores,
  type S3ConnectionStore,
  type S3CredentialStore,
} from "@faws/lib-s3";
