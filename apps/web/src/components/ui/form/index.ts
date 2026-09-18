/**
 * Shared form pieces.
 *
 * Forms here are react-hook-form bound to the zod schemas exported from
 * @faws/contracts, so a constraint is enforced once and both the tRPC procedure
 * and the form see the same rule.
 *
 * Note for anyone touching UpdateServiceDialog: it predates this module and
 * uses @tanstack/react-form. Porting it is a deliberate, separate change - not
 * something to do halfway while editing something else.
 */
export { Field, FormError } from "./field.tsx";
