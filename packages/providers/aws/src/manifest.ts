/**
 * The manifest is its own package (`./manifest`) so contracts can read it
 * without depending on this provider's server code; it is re-exported here
 * so the provider stays one import away from its own description.
 */
export * from "@faws/provider-aws-manifest";
