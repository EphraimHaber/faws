import { create } from "zustand";

/**
 * Which Kubernetes login dialog is open, if any. One store so an error page,
 * a terminal tab, the command palette and the overview can all open the same
 * dialog, which the app shell renders once.
 */
type KubeLoginDialog =
  | { readonly kind: "add" }
  | { readonly kind: "login"; readonly context: string };

interface KubeLoginDialogState {
  readonly dialog: KubeLoginDialog | null;
}

export const useKubeLoginDialog = create<KubeLoginDialogState>(() => ({ dialog: null }));

export function openAddCluster(): void {
  useKubeLoginDialog.setState({ dialog: { kind: "add" } });
}

export function openKubeLogin(context: string): void {
  useKubeLoginDialog.setState({ dialog: { kind: "login", context } });
}

export function closeKubeLoginDialog(): void {
  useKubeLoginDialog.setState({ dialog: null });
}
