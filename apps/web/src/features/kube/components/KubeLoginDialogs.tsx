import { closeKubeLoginDialog, useKubeLoginDialog } from "~/features/kube/loginDialogs";

import { AddClusterDialog } from "./AddClusterDialog";
import { LoginDialog } from "./LoginDialog";

/** Renders whichever Kubernetes login dialog is open, once, from the app shell. */
export function KubeLoginDialogs() {
  const dialog = useKubeLoginDialog((state) => state.dialog);
  if (!dialog) return null;
  return dialog.kind === "add" ? (
    <AddClusterDialog onClose={closeKubeLoginDialog} />
  ) : (
    <LoginDialog key={dialog.context} context={dialog.context} onClose={closeKubeLoginDialog} />
  );
}
