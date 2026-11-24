import { kubeUserLabel } from "@faws/contracts";
import { useQuery } from "@tanstack/react-query";

import { Dialog } from "~/components/Dialog";
import { Button } from "~/components/ui/button";
import { CopyButton } from "~/components/ui/copy-button";
import { LoadingRows } from "~/components/ui/spinner";
import { trpc } from "~/lib/trpc";

import { ClusterProbe } from "./ClusterProbe";
import { LoginForm } from "./LoginForm";

/**
 * Logging in again to an existing context, with its server and user already
 * filled in. A context that authenticates through a plugin is renewed by that
 * plugin, so it gets the command to run instead of a form.
 */
export function LoginDialog({ context, onClose }: { context: string; onClose: () => void }) {
  const contexts = useQuery({ ...trpc.kubernetes.contexts.queryOptions(), retry: false });
  const found = contexts.data?.find((entry) => entry.name === context);
  const user = found ? kubeUserLabel(found.userName) : "";

  return (
    <Dialog id="kube-login" title={`Log in to ${context}`} onClose={onClose}>
      {contexts.isPending ? (
        <LoadingRows rows={2} />
      ) : !found?.server ? (
        <p className="text-[12.5px] text-danger">
          {contexts.error?.message ?? `There is no context named ${context} in your kubeconfig.`}
        </p>
      ) : found.auth === "exec" || found.auth === "auth-provider" ? (
        <PluginLogin plugin={found.execPlugin} context={context} onClose={onClose} />
      ) : (
        <div className="flex flex-col gap-3">
          {user ? (
            <p className="text-[12.5px] text-muted-foreground">
              As <span className="font-mono text-foreground">{user}</span>, in{" "}
              <span className="font-mono text-foreground">{found.namespace ?? "default"}</span>.
            </p>
          ) : null}
          <ClusterProbe server={found.server}>
            {(probe) => (
              <LoginForm
                target={{ kind: "relogin", context, username: user }}
                probe={probe}
                onDone={onClose}
                onCancel={onClose}
              />
            )}
          </ClusterProbe>
        </div>
      )}
    </Dialog>
  );
}

function PluginLogin({
  plugin,
  context,
  onClose,
}: {
  plugin: string | null;
  context: string;
  onClose: () => void;
}) {
  const command = `kubectl --context=${context} version`;
  return (
    <div className="flex flex-col gap-3 text-[12.5px]">
      <p className="text-muted-foreground">
        This context gets its credentials by running{" "}
        <span className="font-mono text-foreground">{plugin ?? "an auth provider"}</span>, which
        faws does not run for you. Run any kubectl command for it in a terminal and follow what it
        asks, then retry.
      </p>
      <div className="flex items-center gap-2 rounded-md border border-border bg-card/40 px-2.5 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{command}</code>
        <CopyButton value={command} label="command" size="icon" />
      </div>
      <div className="flex justify-end">
        <Button onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}
