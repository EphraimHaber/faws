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
