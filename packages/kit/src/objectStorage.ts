/**
 * The object storage capability's view models.
 *
 * Every provider that stores objects answers in these shapes, and the bucket
 * browser binds to them, so one browser serves every such provider. The
 * optionality of the underlying APIs is already resolved here.
 */

/**
 * What the UI may offer for a connection.
 *
 * An S3 compatible server implements the object API and little around it, so
 * a pane only one provider can fill is better absent than present and failing.
 */
export interface StorageFeatures {
  /** Buckets are addressed in a home region of their own, which only AWS reports. */
  readonly bucketRegions: boolean;
  /** Daily size and count, published by a metrics service beside the store. */
  readonly storageMetrics: boolean;
  /** Signed URLs that the browser can use directly. */
  readonly presign: boolean;
}

/** One day's figure in a storage metric series. */
export interface StorageMetricPoint {
  readonly timestamp: string;
  readonly average: number | null;
  readonly maximum: number | null;
}

export interface StorageMetricSeries {
  readonly metric: string;
  readonly points: ReadonlyArray<StorageMetricPoint>;
}

export interface StorageBucket {
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
export interface StorageCommonPrefix {
  readonly prefix: string;
  /** The last segment, which is what the row shows. */
  readonly name: string;
}

export interface StorageObjectSummary {
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
export interface StorageListPage {
  readonly bucket: string;
  readonly prefix: string;
  readonly prefixes: ReadonlyArray<StorageCommonPrefix>;
  readonly objects: ReadonlyArray<StorageObjectSummary>;
  readonly nextToken: string | null;
}

/**
 * How the UI should open an object.
 *
 * Decided on the server from the stored content type, the key's extension and
 * finally the leading bytes, because only the first of those is authoritative
 * and it is the one most often wrong.
 */
export type StorageOpenAs =
  | "text"
  | "json"
  | "jsonl"
  | "csv"
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "binary";

export interface StorageObjectHead {
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
  readonly openAs: StorageOpenAs;
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
export interface StorageScanProgress {
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
export interface StoragePrefixRollup {
  readonly prefix: string;
  readonly objectCount: number;
  readonly totalBytes: number;
  readonly byStorageClass: Readonly<Record<string, number>>;
}

/** The parts of a bucket's configuration, each its own call and permission. */
export type StorageBucketConfigField =
  | "versioning"
  | "encryption"
  | "publicAccessBlock"
  | "policy"
  | "lifecycle"
  | "tags"
  | "owner";

export interface StorageLifecycleRule {
  readonly id: string;
  readonly status: string;
  readonly prefix: string;
  readonly expiresAfterDays: number | null;
  readonly transitions: ReadonlyArray<{ storageClass: string; afterDays: number | null }>;
}

export interface StorageBucketConfig {
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
  readonly lifecycleRules: ReadonlyArray<StorageLifecycleRule>;
  readonly tags: Readonly<Record<string, string>>;
  readonly ownerName: string | null;
  /**
   * Fields the caller may not read. Reported rather than thrown, because a
   * bucket where everything but the policy is visible is the common case.
   */
  readonly denied: ReadonlyArray<StorageBucketConfigField>;
}

/** One version of a key, or the marker left where a delete happened. */
export interface StorageVersionEntry {
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
export interface StorageVersionPage {
  readonly versions: ReadonlyArray<StorageVersionEntry>;
  readonly nextKeyMarker: string | null;
  readonly nextVersionIdMarker: string | null;
}
