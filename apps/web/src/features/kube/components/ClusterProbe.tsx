import type { KubeClusterProbe, KubeTlsVerdict } from "@faws/contracts";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import * as React from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { LoadingRows } from "~/components/ui/spinner";
import { CertificateTrustDialog } from "~/features/trust/CertificateTrustDialog";
import { trpc } from "~/lib/trpc";

/**
 * Asks what an API server is, shows the answer, and hands over to `children`
 * once there is nothing left in the way: it answered, and both its API and
 * OAuth hosts present certificates this app trusts. Either one that does not
 * gets a "Review certificate" that opens the app's trust dialog.
 */
export function ClusterProbe({
  server,
  children,
}: {
  server: string;
  children: (probe: KubeClusterProbe) => React.ReactNode;
}) {
  const probe = useQuery({
    ...trpc.kubernetes.probeCluster.queryOptions({ server }),
    retry: false,
    staleTime: 0,
  });
  const [reviewing, setReviewing] = React.useState<KubeTlsVerdict | null>(null);

  if (probe.isPending) return <LoadingRows rows={2} />;
  if (probe.isError) {
    return (
      <div className="flex flex-col gap-2">
        <p className="font-mono text-[12px] text-danger">{probe.error.message}</p>
        <Button className="self-start" onClick={() => void probe.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const data = probe.data;
  const blocked = [data.api, data.oauthTls].filter(
    (verdict): verdict is KubeTlsVerdict => verdict !== null && !verdict.authorized,
  );
  const ready = data.reachable && data.problem === null && blocked.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-card/40 px-2.5 py-2">
        <p className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
          <span className="font-mono">{data.server}</span>
          {data.reachable && data.problem === null && data.api?.authorized !== false ? (
            <>
              <Badge tone={data.openShift ? "primary" : "neutral"}>
                {data.openShift ? "OpenShift" : "Kubernetes"}
              </Badge>
              {data.version ? <Badge>{data.version}</Badge> : null}
            </>
          ) : null}
        </p>
        {data.problem ? (
          <p className="font-mono text-[11.5px] text-danger">{data.problem}</p>
        ) : null}
        {data.api ? (
          <TlsLine verdict={data.api} role="API server" onReview={() => setReviewing(data.api)} />
        ) : null}
        {data.oauthTls ? (
          <TlsLine
            verdict={data.oauthTls}
            role="OAuth server"
            onReview={() => setReviewing(data.oauthTls)}
          />
        ) : null}
      </div>
      {data.problem ? (
        <Button className="self-start" onClick={() => void probe.refetch()}>
          Try again
        </Button>
      ) : null}
      {ready ? children(data) : null}
      {reviewing ? (
        <CertificateTrustDialog
          host={reviewing.host}
          port={reviewing.port}
          onClose={() => {
            setReviewing(null);
            void probe.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function TlsLine({
  verdict,
  role,
  onReview,
}: {
  verdict: KubeTlsVerdict;
  role: string;
  onReview: () => void;
}) {
  return (
    <p className="flex items-center gap-2 text-[12px]">
      {verdict.authorized ? (
        <ShieldCheck className="size-3.5 shrink-0 text-success" strokeWidth={1.8} aria-hidden />
      ) : (
        <ShieldAlert className="size-3.5 shrink-0 text-danger" strokeWidth={1.8} aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        {role} <span className="font-mono">{`${verdict.host}:${verdict.port}`}</span>{" "}
        {verdict.authorized ? "is trusted." : (verdict.errorMessage ?? "is not trusted.")}
      </span>
      {verdict.authorized ? null : (
        <Button variant="default" size="xs" onClick={onReview}>
          Review certificate
        </Button>
      )}
    </p>
  );
}
