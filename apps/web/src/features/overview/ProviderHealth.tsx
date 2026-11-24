import type { ProviderId } from "@faws/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Settings2 } from "lucide-react";

import { textActionClass } from "~/components/ui/text-action";
import { EmptyState } from "~/components/ui/empty";
import { useKubeDiagnostics } from "~/features/kube/useKubeDiagnostics";
import { useS3Connections } from "~/features/s3/useS3Connections";
import { trpc } from "~/lib/trpc";
import { findProvider, type ProviderDefinition } from "~/services/registry";
import { useAwsScope, useEnabledProviders, useKubeScope } from "~/stores/scope";

import { HealthTile } from "./HealthTile";

/**
 * Every enabled provider's state, side by side: the first thing the overview
 * answers is "is everything I depend on reachable", before any one service.
 */
export function ProviderHealth() {
  const enabled = useEnabledProviders();

  if (enabled.length === 0) {
    return (
      <EmptyState
        icon={Settings2}
        title="Nothing to connect to yet"
        hint={
          <>
            Every provider is switched off.{" "}
            <Link to="/settings" className={textActionClass}>
              Choose what to connect to
            </Link>
            .
          </>
        }
      />
    );
  }

  return (
    <section aria-label="Providers" className="grid shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {enabled.map((id) => (
        <Tile key={id} id={id} />
      ))}
    </section>
  );
}

function Tile({ id }: { id: ProviderId }) {
  const provider = findProvider(id);
  if (!provider) return null;
  switch (id) {
    case "aws":
      return <AwsTile provider={provider} />;
    case "kubernetes":
      return <KubernetesTile provider={provider} />;
    case "s3":
      return <StorageTile provider={provider} />;
  }
}

function AwsTile({ provider }: { provider: ProviderDefinition }) {
  const scope = useAwsScope();
  const whoami = useQuery({ ...trpc.aws.whoami.queryOptions(scope), retry: false });
  return (
    <HealthTile
      provider={provider}
      to="/ecs"
      refresh={whoami}
      tone={whoami.isPending ? "neutral" : whoami.isError ? "danger" : "success"}
      headline={
        whoami.isPending
          ? "Checking credentials…"
          : whoami.isError
            ? whoami.error.message
            : `Signed in to ${whoami.data.accountId}`
      }
      facts={[
        { label: "profile", value: scope.profile },
        { label: "region", value: scope.region },
        ...(whoami.data ? [{ label: "identity", value: whoami.data.arn }] : []),
      ]}
    />
  );
}

function KubernetesTile({ provider }: { provider: ProviderDefinition }) {
  const diagnostics = useKubeDiagnostics();
  const { context, namespace } = useKubeScope();
  const data = diagnostics.data;
  const tool = data?.reader ?? null;
  const tone = diagnostics.isPending
    ? "neutral"
    : diagnostics.isError || !data?.kubeconfigFound || !tool
      ? "danger"
      : data.contextNames.length === 0
        ? "warning"
        : "success";
  const headline = diagnostics.isPending
    ? "Reading your kubeconfig…"
    : diagnostics.isError
      ? diagnostics.error.message
      : !data?.kubeconfigFound
        ? "No kubeconfig found"
        : !tool
          ? "Neither kubectl nor oc is installed"
          : data.contextNames.length === 0
            ? "Your kubeconfig has no contexts"
            : `${data.contextNames.length} context${data.contextNames.length === 1 ? "" : "s"} through ${tool}`;
  return (
    <HealthTile
      provider={provider}
      to="/kubernetes/workloads"
      refresh={diagnostics}
      tone={tone}
      headline={headline}
      facts={[
        { label: "context", value: context || "-" },
        { label: "namespace", value: namespace || "-" },
        ...(data
          ? [
              {
                label: "add-ons",
                value:
                  [data.openShift ? "OpenShift" : null, data.kubeVirt ? "KubeVirt" : null]
                    .filter(Boolean)
                    .join(", ") || "none",
              },
            ]
          : []),
      ]}
    />
  );
}

function StorageTile({ provider }: { provider: ProviderDefinition }) {
  const connections = useS3Connections();
  return (
    <HealthTile
      provider={provider}
      to="/s3/connections"
      tone={connections.length > 0 ? "success" : "neutral"}
      headline={
        connections.length > 0
          ? `${connections.length} saved endpoint${connections.length === 1 ? "" : "s"}`
          : "No endpoints saved yet"
      }
      facts={connections.slice(0, 3).map((connection) => ({
        label: connection.name,
        value: connection.endpoint,
      }))}
      action={
        <Link to="/s3/connections" className={textActionClass}>
          {connections.length > 0 ? "manage endpoints" : "add an endpoint"}
        </Link>
      }
    />
  );
}
