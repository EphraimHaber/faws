/**
 * Flattened S3 view models.
 *
 * The SDK shapes are deeply optional and carry more than the UI reads. These
 * types are the contract between the server fetchers and the renderer:
 * everything the tables and detail panes bind to, with the optionality already
 * resolved.
 */

export interface S3Bucket {
  readonly name: string;
  readonly createdAt: string | null;
  /**
   * Absent until something needs it. Resolving the home region of every bucket
   * up front is one call per bucket, which on a large account is a slower page
   * than the list it is decorating.
   */
  readonly region: string | null;
}

/** A folder, as far as the browser is concerned: a shared key prefix. */
export interface S3CommonPrefix {
  readonly prefix: string;
  /** The last segment, which is what the row shows. */
  readonly name: string;
}

export interface S3ObjectSummary {
  readonly key: string;
  /** The key with the listed prefix removed. */
  readonly name: string;
  readonly size: number;
  readonly lastModified: string | null;
  readonly etag: string | null;
  readonly storageClass: string;
}

/**
 * One page of a listing.
 *
 * `nextToken` is the continuation token passed back verbatim to read the page
 * after this one. A listing that walked every page before returning would hold
 * a whole bucket in memory on both sides.
 */
export interface S3ListPage {
  readonly bucket: string;
  readonly prefix: string;
  readonly prefixes: ReadonlyArray<S3CommonPrefix>;
  readonly objects: ReadonlyArray<S3ObjectSummary>;
  readonly nextToken: string | null;
}

/**
 * How the UI should open an object.
 *
 * Decided on the server from the stored content type, the key's extension and
 * finally the leading bytes, because only the first of those is authoritative
 * and it is the one most often wrong.
 */
export type S3OpenAs =
  | "text"
  | "json"
  | "jsonl"
  | "csv"
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "binary";

export interface S3ObjectHead {
  readonly bucket: string;
  readonly key: string;
  readonly size: number;
  readonly contentType: string | null;
  /** Set when the stored object is compressed rather than the transfer. */
  readonly contentEncoding: string | null;
  readonly lastModified: string | null;
  readonly etag: string | null;
  readonly versionId: string | null;
  readonly storageClass: string;
  readonly serverSideEncryption: string | null;
  readonly kmsKeyId: string | null;
  readonly metadata: Readonly<Record<string, string>>;
  readonly openAs: S3OpenAs;
  /**
   * False for archived storage with no completed restore. The bytes exist but
   * cannot be read until a restore finishes, which is a different message from
   * a failure.
   */
  readonly readable: boolean;
  /** Present while an archived object is being restored, or once it has been. */
  readonly restore: string | null;
}

/** How far a recursive scan has got, and whether it stopped early. */
export interface S3ScanProgress {
  readonly scanned: number;
  readonly matched: number;
  /** Bytes seen, matched or not, which is what a rollup counts. */
  readonly bytes: number;
  /** The last key read, so a running scan can say where it is. */
  readonly currentPrefix: string;
  readonly done: boolean;
  /** True when a ceiling stopped the walk before the prefix ran out. */
  readonly truncated: boolean;
}

/** Size and count under a prefix, accumulated as the scan walks it. */
export interface S3PrefixRollup {
  readonly prefix: string;
  readonly objectCount: number;
  readonly totalBytes: number;
  readonly byStorageClass: Readonly<Record<string, number>>;
}

/** The parts of a bucket's configuration, each its own call and permission. */
export type S3BucketConfigField =
  | "versioning"
  | "encryption"
  | "publicAccessBlock"
  | "policy"
  | "lifecycle"
  | "tags"
  | "owner";

export interface S3LifecycleRule {
  readonly id: string;
  readonly status: string;
  readonly prefix: string;
  readonly expiresAfterDays: number | null;
  readonly transitions: ReadonlyArray<{ storageClass: string; afterDays: number | null }>;
}

export interface S3BucketConfig {
  readonly versioning: "Enabled" | "Suspended" | "Disabled";
  readonly mfaDelete: boolean;
  readonly encryption: { algorithm: string; kmsKeyId: string | null } | null;
  readonly publicAccessBlock: {
    blockPublicAcls: boolean;
    ignorePublicAcls: boolean;
    blockPublicPolicy: boolean;
    restrictPublicBuckets: boolean;
  } | null;
  readonly policyJson: string | null;
  readonly lifecycleRules: ReadonlyArray<S3LifecycleRule>;
  readonly tags: Readonly<Record<string, string>>;
  readonly ownerName: string | null;
  /**
   * Fields the caller may not read. Reported rather than thrown, because a
   * bucket where everything but the policy is visible is the common case.
   */
  readonly denied: ReadonlyArray<S3BucketConfigField>;
}

/** One version of a key, or the marker left where a delete happened. */
export interface S3VersionEntry {
  readonly key: string;
  readonly versionId: string;
  readonly isLatest: boolean;
  readonly isDeleteMarker: boolean;
  readonly size: number;
  readonly lastModified: string | null;
  readonly etag: string | null;
  readonly storageClass: string;
}

/** A page of versions. This API pages on two markers rather than one token. */
export interface S3VersionPage {
  readonly versions: ReadonlyArray<S3VersionEntry>;
  readonly nextKeyMarker: string | null;
  readonly nextVersionIdMarker: string | null;
}
