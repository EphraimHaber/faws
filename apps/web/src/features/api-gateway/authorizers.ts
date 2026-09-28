/**
 * What a REST API's authorizers point at, and which methods lean on each.
 */
import type { RestApiResource } from "@faws/contracts";

/** The Lambda function an authorizer or integration URI invokes. */
export interface LambdaTarget {
  /** The function ARN as the URI names it, alias or version included. */
  readonly arn: string;
  readonly region: string;
  readonly name: string;
  /** An alias, a version, or a stage variable reference such as `${stageVariables.alias}`. */
  readonly qualifier: string | null;
}

/**
 * The Lambda function a `.../functions/{arn}/invocations` URI names, or
 * `null` when the URI invokes something else.
 */
export function lambdaFromUri(uri: string): LambdaTarget | null {
  const match = /\/functions\/(arn:[^:]+:lambda:([^:]+):[^:]*:function:[^/]+)\/invocations/.exec(
    uri,
  );
  if (!match?.[1] || !match[2]) return null;
  const arn = match[1];
  const [name = "", ...rest] = arn
    .slice(arn.indexOf(":function:") + ":function:".length)
    .split(":");
  if (!name) return null;
  return { arn, region: match[2], name, qualifier: rest.length > 0 ? rest.join(":") : null };
}

/** A method that an authorizer guards. */
export interface AuthorizedMethod {
  readonly resourceId: string;
  readonly path: string;
  readonly httpMethod: string;
}

/** The methods each authorizer guards, keyed by authorizer id, in path order. */
export function methodsByAuthorizer(
  resources: ReadonlyArray<RestApiResource>,
): Map<string, AuthorizedMethod[]> {
  const byAuthorizer = new Map<string, AuthorizedMethod[]>();
  const ordered = resources.toSorted((a, b) => a.path.localeCompare(b.path));
  for (const resource of ordered) {
    for (const method of resource.methods) {
      if (!method.authorizerId) continue;
      const list = byAuthorizer.get(method.authorizerId) ?? [];
      list.push({ resourceId: resource.id, path: resource.path, httpMethod: method.httpMethod });
      byAuthorizer.set(method.authorizerId, list);
    }
  }
  return byAuthorizer;
}
