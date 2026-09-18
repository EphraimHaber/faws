/**
 * S3 connections: where S3 calls go, when they do not go to AWS.
 *
 * The API is a de facto standard with many server implementations - MinIO,
 * Ceph RGW, StorageGRID, ECS, Wasabi - and an on prem one differs from AWS in
 * four ways that all have to be described somewhere: it lives at a URL of its
 * own, it usually wants path style addressing, its credentials are not in
 * `~/.aws`, and its certificate is often signed by a CA only that network
 * trusts.
 *
 * A record here is safe to send to a renderer: every secret it needs lives
 * outside it, under `secretKeys`, so the only thing that crosses the wire is
 * whether one is set.
 */
import { z } from "zod";

/**
 * How the client proves who it is.
 *
 * `aws-profile` exists because an S3 compatible endpoint can still be fronting
 * real AWS credentials (a gateway, an accelerator), and re-typing keys that
 * `~/.aws` already holds is how they end up in two places.
 */
export type S3ConnectionCredentials =
  | { readonly mode: "aws-profile"; readonly profile: string }
  | { readonly mode: "static"; readonly accessKeyId: string }
  | { readonly mode: "anonymous" };

export interface S3ConnectionTls {
  /**
   * Off skips certificate verification entirely, which is the one setting here
   * that can turn a private network call into an interceptable one.
   */
  readonly verify: boolean;
  /** Extra CA certificates by path, for a CA only this network trusts. */
  readonly caPaths: ReadonlyArray<string>;
  /** The same thing pasted, for a machine where the file is not on disk. */
  readonly caPem: string | null;
  /** Client certificate and key, for an endpoint that asks for mTLS. */
  readonly clientCertPath: string | null;
  readonly clientKeyPath: string | null;
  /**
   * The name the certificate is checked against, when it does not match the
   * host in the URL - common where the endpoint is reached by IP.
   */
  readonly servername: string | null;
  /**
   * A SHA-256 fingerprint the presented certificate must equal, colon hex.
   *
   * Pinning is the answer to a self signed certificate that turning
   * verification off would also answer: it accepts exactly one certificate
   * instead of accepting every certificate.
   */
  readonly pinnedSha256: string | null;
}

/**
 * What this endpoint is known to be unable to do.
 *
 * Only the two that cannot degrade at the call site are configurable. A
 * refused or unimplemented bucket property answers the pane field by field;
 * storage metrics come from a service that is not part of the S3 API at all,
 * and a presigned URL fails in the browser rather than here.
 */
export interface S3ConnectionFeatures {
  /** CloudWatch publishes these, so they exist only on real AWS. */
  readonly storageMetrics: boolean;
  /** Browser writes straight to the endpoint, which needs its CORS policy. */
  readonly presign: boolean;
}

export interface S3Connection {
  readonly id: string;
  readonly name: string;
  /** Base URL of the endpoint, scheme included. */
  readonly endpoint: string;
  /** The region the signature is computed for, which many servers ignore. */
  readonly region: string;
  /**
   * Path style puts the bucket in the path rather than the hostname. Most on
   * prem servers only do this, and a virtual hosted request to them either 404s
   * or needs wildcard DNS and a wildcard certificate.
   */
  readonly forcePathStyle: boolean;
  readonly credentials: S3ConnectionCredentials;
  readonly tls: S3ConnectionTls;
  readonly features: S3ConnectionFeatures;
  /** Which secrets are set, never the secrets. */
  readonly secretKeys: ReadonlyArray<S3ConnectionSecret>;
  /** Bumped on every save, so a cached client can tell it is stale. */
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The secrets a connection can hold, each stored under its own key. */
export type S3ConnectionSecret = "secretAccessKey" | "sessionToken" | "clientKeyPassphrase";

/**
 * Where an S3 call is pointed.
 *
 * Without a connection this is the AWS profile and region every other service
 * uses, so an AWS scope is a valid S3 scope as it stands.
 */
export interface S3Scope {
  readonly profile: string;
  readonly region: string;
  readonly connectionId?: string | null | undefined;
}

/** What the UI may offer for the connection in scope. */
export interface S3Capabilities {
  /** Buckets are addressed in their own region, which only AWS reports. */
  readonly bucketRegions: boolean;
  readonly storageMetrics: boolean;
  readonly presign: boolean;
}

/**
 * One end of a connection test.
 *
 * The TLS verdict is separate from the S3 verdict because they fail for
 * unrelated reasons and only one of them is fixed by adding a CA: an endpoint
 * whose certificate is untrusted and whose keys are wrong should say both.
 */
export interface S3ConnectionProbe {
  readonly reachable: boolean;
  readonly tls: S3ProbeTls | null;
  readonly s3: S3ProbeCall;
}

export interface S3ProbeTls {
  readonly trusted: boolean;
  /** Why the chain was refused, in OpenSSL's own words. */
  readonly error: string | null;
  readonly subject: string;
  readonly issuer: string;
  readonly validFrom: string;
  readonly validTo: string;
  /** Colon hex, the form the pin is stored and compared in. */
  readonly fingerprintSha256: string;
  readonly selfSigned: boolean;
}

export interface S3ProbeCall {
  readonly ok: boolean;
  readonly bucketCount: number | null;
  readonly error: string | null;
  readonly code: string | null;
}

const PEM_HINT = "Paste the certificate in PEM form, beginning with -----BEGIN CERTIFICATE-----.";

/**
 * An endpoint URL.
 *
 * A path is rejected rather than ignored: the SDK would prepend it to every
 * request, and a trailing slash alone is enough to produce a double slash in
 * the signed path that some servers reject and others silently treat as a key
 * whose first character is a slash.
 */
const endpointUrl = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a full URL, such as https://s3.corp:9000." });
      return;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      ctx.addIssue({ code: "custom", message: "The endpoint has to be http or https." });
    }
    if (url.pathname !== "/" && url.pathname !== "") {
      ctx.addIssue({ code: "custom", message: "Drop the path; the endpoint is the origin only." });
    }
    if (url.search || url.hash) {
      ctx.addIssue({ code: "custom", message: "Drop the query; the endpoint is the origin only." });
    }
  });

/** Colon separated hex, the form `openssl x509 -fingerprint -sha256` prints. */
const fingerprint = z
  .string()
  .trim()
  .regex(
    /^(?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/,
    "A SHA-256 fingerprint is 32 colon separated bytes.",
  )
  .transform((value) => value.toUpperCase());

const pemBlock = z
  .string()
  .trim()
  .refine((value) => value.includes("-----BEGIN"), PEM_HINT);

/**
 * A field that is either filled in or not filled in.
 *
 * A text input always submits a string, so an untouched one arrives as `""`;
 * reading that as a value rather than as absence is how a blank field ends up
 * stored as an empty path or an empty name.
 */
function optional<Out, In>(inner: z.ZodType<Out, In>): z.ZodType<Out | null, unknown> {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? null : value),
    inner.nullish().transform((value) => value ?? null),
  );
}

export const s3ConnectionTlsSchema = z.object({
  verify: z.boolean().default(true),
  caPaths: z
    .array(z.string())
    .max(8)
    .transform((paths) => paths.filter((path) => path.trim().length > 0))
    .default([]),
  caPem: optional(pemBlock),
  clientCertPath: optional(z.string()),
  clientKeyPath: optional(z.string()),
  servername: optional(z.string()),
  pinnedSha256: optional(fingerprint),
});

/** What a connection starts as: verified TLS, no extra trust, no mTLS. */
export const DEFAULT_TLS: S3ConnectionTls = {
  verify: true,
  caPaths: [],
  caPem: null,
  clientCertPath: null,
  clientKeyPath: null,
  servername: null,
  pinnedSha256: null,
};

export const DEFAULT_FEATURES: S3ConnectionFeatures = {
  storageMetrics: false,
  presign: true,
};

export const s3ConnectionFeaturesSchema = z.object({
  storageMetrics: z.boolean().default(false),
  presign: z.boolean().default(true),
});

/**
 * Saving a connection.
 *
 * Secrets are write only and optional on an update: an absent one leaves what
 * is stored alone, so editing the name of a connection does not require
 * re-typing its keys, and an empty string is how one is cleared.
 */
export const s3ConnectionInputSchema = z
  .object({
    /** Absent creates; present updates that connection in place. */
    id: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(64),
    endpoint: endpointUrl,
    region: z.string().trim().min(1).max(64).default("us-east-1"),
    forcePathStyle: z.boolean().default(true),
    credentialMode: z.enum(["static", "aws-profile", "anonymous"]).default("static"),
    profile: z.string().min(1).optional(),
    accessKeyId: z.string().trim().optional(),
    /**
     * Blank means "leave what is stored alone", which is what an editing form
     * submits for a secret it was never shown.
     */
    secretAccessKey: z.string().optional(),
    sessionToken: z.string().optional(),
    clientKeyPassphrase: z.string().optional(),
    tls: s3ConnectionTlsSchema.default(() => ({ ...DEFAULT_TLS, caPaths: [] })),
    features: s3ConnectionFeaturesSchema.default(() => ({ ...DEFAULT_FEATURES })),
  })
  .superRefine((input, ctx) => {
    if (input.credentialMode === "aws-profile" && !input.profile) {
      ctx.addIssue({ code: "custom", path: ["profile"], message: "Pick a profile." });
    }
    if (input.credentialMode === "static") {
      if (!input.accessKeyId) {
        ctx.addIssue({ code: "custom", path: ["accessKeyId"], message: "Enter an access key id." });
      }
      // A new connection has nothing stored to fall back on, so the secret is
      // required exactly when there is no id.
      if (input.id === undefined && !input.secretAccessKey?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["secretAccessKey"],
          message: "Enter a secret access key.",
        });
      }
    }
    if (input.tls.clientCertPath && !input.tls.clientKeyPath) {
      ctx.addIssue({
        code: "custom",
        path: ["tls", "clientKeyPath"],
        message: "A client certificate needs its key.",
      });
    }
    if (input.tls.clientKeyPath && !input.tls.clientCertPath) {
      ctx.addIssue({
        code: "custom",
        path: ["tls", "clientCertPath"],
        message: "A client key needs its certificate.",
      });
    }
  });

export type S3ConnectionInput = z.infer<typeof s3ConnectionInputSchema>;

export const s3ConnectionRefSchema = z.object({ id: z.string().min(1) });

/** Testing an unsaved form, which is the only time it is worth testing. */
export const s3ConnectionProbeSchema = s3ConnectionInputSchema;

/**
 * The scope an S3 procedure takes.
 *
 * The profile and region stay even when a connection is chosen: they are what
 * the bucket listing falls back to, and what a connection borrowing AWS
 * credentials resolves against.
 */
export const s3ScopeSchema = z.object({
  profile: z.string(),
  region: z.string().min(1),
  connectionId: z.string().min(1).nullish(),
});
