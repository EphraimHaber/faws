import { AlertTriangle, RotateCw } from "lucide-react";

import { Button } from "./button.tsx";

/**
 * AWS errors are the normal case here, not an exception: an expired SSO
 * token, a region the account can't reach, a missing permission. Each one
 * shows the SDK's own message rather than a generic failure.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <AlertTriangle className="size-5 text-danger" strokeWidth={1.7} />
      <p className="max-w-lg font-mono text-[12px] leading-relaxed text-foreground">{message}</p>
      {onRetry ? (
        <Button onClick={onRetry}>
          <RotateCw className="size-3" /> Retry
        </Button>
      ) : null}
    </div>
  );
}
