import { AwsRequestError, EndpointTrustError, ProfileNotFoundError } from "@faws/contracts";
import { DomainError } from "@faws/kit";
import { trustReason } from "@faws/shared";

/**
 * Runs an S3 call and restates its faults as the app's own errors, so the
 * transport maps them to stable codes without knowing the SDK.
 *
 * A `DomainError` raised inside (a refused certificate restated by an
 * endpoint client, a guard) already says what it means and passes through.
 */
export async function callS3<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DomainError) throw err;
    const name = (err as { name?: string }).name ?? "UnknownError";
    const message = err instanceof Error ? err.message : String(err);
    if (name === "CredentialsProviderError" || /could not be found/i.test(message)) {
      throw new ProfileNotFoundError(message);
    }
    // A refused certificate is a trust decision, not a storage fault: typically
    // a proxy re-signing traffic with a CA this machine does not trust yet.
    const trust = trustReason(err);
    if (trust) throw new EndpointTrustError("S3", trust);
    throw new AwsRequestError(message, { code: name, service: "s3" });
  }
}
