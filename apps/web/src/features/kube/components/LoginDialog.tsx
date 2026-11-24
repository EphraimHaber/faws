import { Dialog } from "~/components/Dialog";
import { Button } from "~/components/ui/button";
import { CopyButton } from "~/components/ui/copy-button";
import type { ExpiredKubeLogin } from "~/lib/errorCause";

/** Logging in again to a context whose token has expired. */
export function LoginDialog({ login, onClose }: { login: ExpiredKubeLogin; onClose: () => void }) {
  const command = `oc login --server=${login.server ?? "<api-url>"}`;
  return (
    <Dialog id="kube-login" title={`Log in to ${login.context}`} onClose={onClose}>
      <div className="flex flex-col gap-3 text-[12.5px]">
        <p className="text-muted-foreground">
          The cluster no longer accepts this context&apos;s token. Run this in a terminal, then
          retry; faws reads the same kubeconfig.
        </p>
        <div className="flex items-center gap-2 rounded-md border border-border bg-card/40 px-2.5 py-2">
          <code className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{command}</code>
          <CopyButton value={command} label="command" size="icon" />
        </div>
        <div className="flex justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </Dialog>
  );
}
