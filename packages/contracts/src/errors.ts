/** Thrown when a named AWS profile isn't present in the local shared config. */
export class ProfileNotFoundError extends Error {
  readonly profile: string | undefined;

  constructor(message: string, profile?: string) {
    super(message);
    this.name = "ProfileNotFoundError";
    this.profile = profile;
  }
}

/** Wraps a failed AWS SDK call so the transport layer can map it to a 4xx. */
export class AwsRequestError extends Error {
  readonly code: string | undefined;
  readonly service: string | undefined;

  constructor(message: string, options?: { code?: string; service?: string }) {
    super(message);
    this.name = "AwsRequestError";
    this.code = options?.code;
    this.service = options?.service;
  }
}

/** Raised by the read-only guard when a mutating call is attempted. */
export class ReadOnlyModeError extends Error {
  constructor(operation: string) {
    super(`Read-only mode is on; "${operation}" was blocked.`);
    this.name = "ReadOnlyModeError";
  }
}
