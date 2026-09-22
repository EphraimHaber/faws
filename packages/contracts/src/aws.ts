/** A profile entry parsed out of ~/.aws/config and ~/.aws/credentials. */
export interface AwsProfile {
  readonly name: string;
  readonly region: string | null;
  readonly source: "config" | "credentials";
  /** True when the profile is backed by IAM Identity Center (SSO). */
  readonly sso: boolean;
}

/** Result of sts:GetCallerIdentity for the active profile. */
export interface Whoami {
  readonly accountId: string;
  readonly arn: string;
  readonly userId: string;
}

/** Every AWS call takes the profile/region the UI is currently pointed at. */
export interface AwsScope {
  readonly profile: string;
  readonly region: string;
}

/**
 * The two switches in front of every mutation.
 *
 * Deliberately not a setting: they are seeded from the environment and reset
 * every launch, which is the point of them. A destructive-mode switch that
 * survived a restart would be a footgun rather than a preference.
 *
 * `destructive` is only ever meaningful while `readOnly` is false; the guard
 * clears it whenever read-only is turned back on, so the pair cannot describe
 * "blocked from writing, but armed to delete".
 */
export interface WriteMode {
  readonly readOnly: boolean;
  readonly destructive: boolean;
}

/** What a write needs before it is allowed. */
export type WriteNeed = "write" | "destructive";
