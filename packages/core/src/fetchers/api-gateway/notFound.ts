import { AwsRequestError } from "@faws/contracts";

/**
 * What `read` returns, or `null` when API Gateway answers that the thing it
 * asked for does not exist. A stale link or a pin from another region is an
 * answer, not a fault.
 */
export async function nullIfNotFound<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof AwsRequestError && err.code === "NotFoundException") return null;
    throw err;
  }
}
