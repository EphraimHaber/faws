/**
 * The error every layer of the exec stack throws.
 *
 * It lives in its own module so a driver can throw one without importing the
 * registry, and so the namespace can recognise one without importing a driver.
 * The `code` is the whole point: it is what the UI switches on to offer the
 * right next step, so an error that reaches the client as "Internal" has lost
 * the only part of itself that was useful.
 */
import type { ExecErrorCode } from "@faws/contracts";

export class ExecSessionError extends Error {
  readonly code: ExecErrorCode;

  constructor(code: ExecErrorCode, message: string) {
    super(message);
    this.name = "ExecSessionError";
    this.code = code;
  }
}

/** True for an error that already carries a code worth showing. */
export function isExecSessionError(err: unknown): err is ExecSessionError {
  return err instanceof ExecSessionError;
}
