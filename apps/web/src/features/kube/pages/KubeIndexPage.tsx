import { useQuery } from "@tanstack/react-query";
import { Boxes, Monitor, Ship } from "lucide-react";

import { SectionCard } from "~/components/section-card";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { useKubeScope } from "~/contexts/ScopeContext";
import { KubeScopePicker } from "~/features/kube/components/KubeScopePicker";
import { hasNoCli, NoKubectl } from "~/features/kube/components/NoKubectl";
import { useKubeDiagnostics } from "~/features/kube/useKubeDiagnostics";
import { trpc } from "~/lib/trpc";

/**
 * The front door of the Kubernetes section.
 *
 * The counts lead for the reason `SectionCard` gives: "Workloads" tells you
 * nothing the sidebar did not, and "31" tells you whether to click. The virtual
 * machines card is absent rather than empty when the cluster has no KubeVirt,
 * which is the same choice S3 makes for panes only AWS can fill.
 */
export function KubeIndexPage() {
  const { context, namespace, ready } = useKubeScope();
  const diagnostics = useKubeDiagnostics();

  const scope = { context, namespace };
  const pods = useQuery({
    ...trpc.kube.pods.queryOptions(scope),
    enabled: ready,
    retry: false,
  });
  const machines = useQuery({
    ...trpc.kube.virtualMachines.queryOptions(scope),
    enabled: ready && (diagnostics.data?.kubeVirt ?? false),
    retry: false,
  });

  const podCount = pods.data?.length ?? 0;
  const vmCount = machines.data?.length ?? 0;
  const contextCount = diagnostics.data?.contextNames.length ?? 0;

  return (
    <Panel className="flex-1">
      <PanelHeader>
        <PanelTitle>Kubernetes</PanelTitle>
        <div className="ml-auto">
          <KubeScopePicker />
        </div>
      </PanelHeader>

      {diagnostics.data && hasNoCli(diagnostics.data) ? (
        <NoKubectl diagnostics={diagnostics.data} />
      ) : (
        <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
          <SectionCard
            to="/kubernetes/contexts"
            icon={Ship}
            label="Contexts"
            description="Every context in your kubeconfig, the server it points at, and how it authenticates."
            metric={diagnostics.isPending ? "…" : String(contextCount)}
            metricLabel={contextCount === 1 ? "context" : "contexts"}
          />
          <SectionCard
            to="/kubernetes/workloads"
            icon={Boxes}
            label="Workloads"
            description="Pods in this namespace, and whether a shell will land in one."
            metric={pods.isPending && ready ? "…" : String(podCount)}
            metricLabel={podCount === 1 ? "pod" : "pods"}
          />
          {diagnostics.data?.kubeVirt ? (
            <SectionCard
              to="/kubernetes/virtual-machines"
              icon={Monitor}
              label="Virtual machines"
              description="KubeVirt machines, with a console and an SSH onto the ones that are running."
              metric={machines.isPending ? "…" : String(vmCount)}
              metricLabel={vmCount === 1 ? "machine" : "machines"}
            />
          ) : null}
        </div>
      )}
    </Panel>
  );
}
