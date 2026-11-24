import { DomainError } from "@faws/kit";

/** Where an expired or refused login points, so the renderer can offer to log in again. */
export interface KubeLoginTarget {
  readonly context: string;
  readonly server: string | null;
  readonly user: string;
}

/**
 * The cluster answered 401: the token in the kubeconfig has expired or been
 * revoked. OpenShift tokens last a day by default, so this is routine.
 */
export class KubeUnauthorizedError extends DomainError {
  readonly kind = "KubeUnauthorized";
  readonly status = "PRECONDITION_FAILED";
  readonly context: string;
  readonly server: string | null;
  readonly user: string;

  constructor(target: KubeLoginTarget) {
    super(
      `Your login to ${target.server ?? target.context}${target.user ? ` as ${userLabel(target.user)}` : ""} has expired or was revoked. Log in again to keep working with ${target.context}.`,
    );
    this.name = "KubeUnauthorizedError";
    this.context = target.context;
    this.server = target.server;
    this.user = target.user;
  }

  protected override details() {
    return { context: this.context, server: this.server, user: this.user };
  }
}

/** `alice/api-example-com:6443` is the user `alice` as `oc login` names it. */
export function userLabel(user: string): string {
  const slash = user.indexOf("/");
  return slash > 0 ? user.slice(0, slash) : user;
}
