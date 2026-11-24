/**
 * Certificates this app trusts beyond the ones Node ships with.
 *
 * For networks with their own certificate authority - a corporate proxy that
 * re-signs traffic to AWS, a MinIO behind an internal CA. Each entry is a
 * public certificate, never a key, so it can live in the settings file the
 * renderer reads.
 */
import { z } from "zod";

export const trustEntrySchema = z.object({
  id: z.string().min(1),
  /** The certificate's common name, or whatever the person called it. */
  label: z.string().catch(""),
  /** Colon hex, upper case. */
  fingerprintSha256: z.string().min(1),
  subject: z.string().catch(""),
  issuer: z.string().catch(""),
  validTo: z.string().catch(""),
  /** A CA vouches for whatever it signed; a self-signed leaf vouches for itself only. */
  kind: z.enum(["ca", "self-signed"]).catch("ca"),
  pem: z.string().min(1),
  addedAt: z.string().catch(""),
  /** Where it was trusted from: a host it was presented by, or "imported". */
  addedFrom: z.string().catch(""),
});

export type TrustEntry = z.infer<typeof trustEntrySchema>;

export const trustSettingsSchema = z.object({
  /** Also trust the operating system's own certificate store. */
  useSystemStore: z.boolean().catch(false),
  /** Parsed one at a time, so one unreadable entry costs only itself. */
  entries: z
    .array(z.unknown())
    .catch([])
    .transform((entries) =>
      entries.flatMap((entry) => {
        const parsed = trustEntrySchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
});

/** One certificate as a server presented it, for a person deciding whether to trust it. */
export interface PresentedCertificate {
  readonly subject: string;
  readonly issuer: string;
  readonly commonName: string;
  readonly subjectAltName: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly fingerprintSha256: string;
  readonly isCA: boolean;
  readonly selfSigned: boolean;
  readonly expired: boolean;
  /** Already in this app's trust store. */
  readonly trusted: boolean;
}

/** What a TLS handshake with a host showed, leaf first. */
export interface PresentedChain {
  readonly host: string;
  readonly port: number;
  readonly chain: ReadonlyArray<PresentedCertificate>;
  /** Whether the handshake succeeds as things stand. */
  readonly authorized: boolean;
  /** OpenSSL's code for why not, e.g. SELF_SIGNED_CERT_IN_CHAIN. */
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  /**
   * Whether trusting a certificate in this chain could fix it. An expired
   * certificate or one issued for another name stays refused whatever is
   * trusted, and the dialog says so instead of offering a button that would
   * not help.
   */
  readonly fixableByTrust: boolean;
}

export const trustTargetSchema = z.object({
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535).default(443),
});

export const trustAddSchema = trustTargetSchema.extend({
  /** Which of the presented certificates to trust, by fingerprint. */
  fingerprints: z.array(z.string().min(1)).min(1).max(10),
});

export const trustImportSchema = z.object({
  pem: z.string().min(1).max(200_000),
  label: z.string().max(200).default(""),
});
