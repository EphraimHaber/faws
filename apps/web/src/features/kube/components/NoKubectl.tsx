import type { KubeDiagnostics } from "@faws/contracts";
import { Ship } from "lucide-react";

import { EmptyState } from "~/components/ui/empty";

/**
 * The state every Kubernetes page has to be able to render: this machine does
 * not do Kubernetes.
 *
 * A sentence with the install command in it rather than an error, and the
 * sidebar row stays where it is - the same shape EC2 uses for an instance
 * nothing can reach. Removing the section would answer "why is Kubernetes
 * missing" with nothing at all, and an error would claim something is broken
 * when nothing is.
 */
export function NoKubectl({ diagnostics }: { diagnostics: KubeDiagnostics }) {
  return (
    <EmptyState
      icon={Ship}
      title="No kubectl on this machine"
      hint={diagnostics.kubectl.problem ?? "Install kubectl, or point FAWS_KUBECTL at it."}
    />
  );
}

/** True when neither reading tool is installed, so nothing can be listed. */
export function hasNoCli(diagnostics: KubeDiagnostics): boolean {
  return !diagnostics.kubectl.found && !diagnostics.oc.found;
}
