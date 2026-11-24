/**
 * The exec error, with this app's codes.
 *
 * The class itself lives in `@faws/kit/server` so a provider's driver can
 * throw one without importing the host; this module narrows its code to the
 * ones the client knows how to explain.
 */
import type { ExecErrorCode } from "@faws/contracts";
import { ExecSessionError as KitExecSessionError } from "@faws/kit/server";

export class ExecSessionError extends KitExecSessionError<ExecErrorCode> {}

/** An exec error from anywhere: the host's own, or one a provider's driver threw. */
export type AnyExecSessionError = KitExecSessionError<ExecErrorCode>;

/** True for an error that already carries a code worth showing. */
export function isExecSessionError(err: unknown): err is AnyExecSessionError {
  return err instanceof KitExecSessionError;
}
