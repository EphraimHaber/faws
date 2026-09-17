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
