import { AlertTriangle, KeyRound, RotateCw, ShieldAlert } from "lucide-react";
import * as React from "react";

import { openKubeLogin } from "~/features/kube/loginDialogs";
import { CertificateTrustDialog } from "~/features/trust/CertificateTrustDialog";
import { expiredKubeLogin, untrustedEndpoint } from "~/lib/errorCause";

import { Button } from "./button.tsx";

/**
 * AWS errors are the normal case here, not an exception: an expired SSO
 * token, a region the account can't reach, a missing permission. Each one
 * shows the SDK's own message rather than a generic failure.
 *
 * A refused certificate is the one failure the app can help fix on the spot,
 * so it also offers to review the certificate and trust its CA. An expired
 * Kubernetes login is the other, and offers to log in again.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  const untrusted = untrustedEndpoint(error);
  const [reviewing, setReviewing] = React.useState(false);
  const expired = expiredKubeLogin(error);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {untrusted ? (
        <ShieldAlert className="size-5 text-danger" strokeWidth={1.7} />
      ) : expired ? (
        <KeyRound className="size-5 text-warning" strokeWidth={1.7} />
      ) : (
        <AlertTriangle className="size-5 text-danger" strokeWidth={1.7} />
      )}
      <p className="max-w-lg font-mono text-[12px] leading-relaxed text-foreground">{message}</p>
      <div className="flex items-center gap-2">
        {untrusted ? (
          <Button variant="default" onClick={() => setReviewing(true)}>
            Review certificate
          </Button>
        ) : null}
        {expired ? (
          <Button variant="default" onClick={() => openKubeLogin(expired.context)}>
            Log in again
          </Button>
        ) : null}
        {onRetry ? (
          <Button onClick={onRetry}>
            <RotateCw className="size-3" /> Retry
          </Button>
        ) : null}
      </div>
      {reviewing && untrusted ? (
        <CertificateTrustDialog
          {...(untrusted.host ? { host: untrusted.host, port: untrusted.port } : {})}
          onClose={() => setReviewing(false)}
        />
      ) : null}
    </div>
  );
}
