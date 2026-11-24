import { defineProvider } from "@faws/kit";

/**
 * Kubernetes and OpenShift, through your own `kubectl`, `oc` and `virtctl`.
 *
 * Never the word "cluster" anywhere in it: `cluster` means an ECS cluster
 * everywhere else in this app, so this provider speaks of contexts,
 * namespaces and workloads. The icon is `ship` because `container` is ECS's.
 */
export const kubernetesManifest = defineProvider({
  id: "kubernetes",
  label: "Kubernetes",
  description: "Contexts from your kubeconfig, through your own kubectl and oc",
  icon: "ship",
  order: 20,
  defaultEnabled: true,
  capabilities: ["workloads", "logs", "terminal", "vms"],
  runtimeDefaults: {
    /** Whether the context in view has the KubeVirt add-on. */
    kubevirt: false,
  },
  services: [
    {
      id: "kubernetes",
      label: "Kubernetes",
      description: "Contexts, workloads and virtual machines, through your own kubectl",
      icon: "ship",
      status: "available",
      basePath: "/kubernetes",
      sections: [
        { id: "contexts", label: "Contexts", icon: "ship", to: "/kubernetes/contexts" },
        { id: "workloads", label: "Workloads", icon: "boxes", to: "/kubernetes/workloads" },
        {
          id: "virtual-machines",
          label: "Virtual machines",
          icon: "monitor",
          to: "/kubernetes/virtual-machines",
          requires: (runtime) => runtime.kubevirt,
        },
      ],
    },
  ],
});
