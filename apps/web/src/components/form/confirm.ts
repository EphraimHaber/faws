/**
 * Whether a typed confirmation matches what was asked for.
 *
 * Surrounding whitespace is forgiven because it is what a paste carries, but
 * case and every other character are not: the point of the gesture is that the
 * name was read and reproduced, and a near miss is the case it exists to catch.
 */
export function confirmMatches(expected: string, typed: string | undefined): boolean {
  if (expected.length === 0) return false;
  return (typed ?? "").trim() === expected;
}

/** How much of the expected string has been typed, for a progress affordance. */
export function confirmProgress(expected: string, typed: string | undefined): number {
  const value = (typed ?? "").trim();
  if (expected.length === 0) return 0;
  let shared = 0;
  while (shared < value.length && shared < expected.length && value[shared] === expected[shared]) {
    shared += 1;
  }
  return shared / expected.length;
}
