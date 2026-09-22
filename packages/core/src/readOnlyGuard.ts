import { ReadOnlyModeError } from "@faws/contracts";

/**
 * Read-only unless the environment says otherwise.
 *
 * The default is the safe one because this process can delete things that do
 * not come back. Turning it off is a deliberate act at launch, not the state
 * someone discovers they were already in.
 */
let readOnly = process.env["FAWS_ALLOW_MUTATIONS"] !== "1";

/**
 * Whether irreversible operations are allowed, on top of read-only being off.
 *
 * Deliberately not persisted and not settable from the environment: it resets
 * to off on every start, so a session that once armed deletion cannot leave
 * the next one armed.
 */
let destructive = false;

export function isReadOnly(): boolean {
  return readOnly;
}

export function setReadOnly(next: boolean): void {
  readOnly = next;
  // Arming deletion and then going back to read-only should not leave the
  // second switch on behind the first.
  if (next) destructive = false;
}

/** Both switches at once, for the callers that report rather than check. */
export function writeMode(): { readOnly: boolean; destructive: boolean } {
  return { readOnly, destructive: isDestructiveAllowed() };
}

export function isDestructiveAllowed(): boolean {
  return !readOnly && destructive;
}

export function setDestructiveAllowed(next: boolean): void {
  destructive = next;
}

/**
 * Call at the top of every mutating operation. Read-only mode is the default
 * posture we want people to be able to trust, so the guard lives in core
 * rather than in the transport layer where a new router could forget it.
 */
export function assertMutable(operation: string): void {
  if (readOnly) throw new ReadOnlyModeError(operation);
}

/**
 * Call instead of `assertMutable` for anything that destroys or overwrites.
 *
 * Writing a new object and deleting an existing one are different risks, and a
 * tool that treats them the same is one misclick from an outage. This is the
 * second switch that separates them.
 */
export function assertDestructive(operation: string): void {
  assertMutable(operation);
  if (!destructive) throw new ReadOnlyModeError(operation, "destructive");
}
