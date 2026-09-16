import { ReadOnlyModeError } from "@faws/contracts";

let readOnly = process.env["FAWS_READ_ONLY"] === "1";

export function isReadOnly(): boolean {
  return readOnly;
}

export function setReadOnly(next: boolean): void {
  readOnly = next;
}

/**
 * Call at the top of every mutating operation. Read-only mode is the default
 * posture we want people to be able to trust, so the guard lives in core
 * rather than in the transport layer where a new router could forget it.
 */
export function assertMutable(operation: string): void {
  if (readOnly) throw new ReadOnlyModeError(operation);
}
