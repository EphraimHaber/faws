import { useQuery } from "@tanstack/react-query";
import { Server, TerminalSquare } from "lucide-react";
import * as React from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { LoadingRows } from "~/components/ui/spinner";
import { useAwsScope } from "~/contexts/ScopeContext";
import { trpc } from "~/lib/trpc";
import { useSessions } from "~/stores/sessions";

/**
 * EC2 instances, listed for one reason: getting a shell on one.
 *
 * So the columns are the ones that decide whether that will work - whether SSM
 * can reach it, whether it has an address, which login its AMI ships with -
 * rather than a general-purpose inventory. An instance nothing can reach says
 * so plainly instead of offering a button that cannot succeed.
 */
export function InstancesPage() {
  const scope = useAwsScope();
  const open = useSessions((state) => state.open);
  const [filter, setFilter] = React.useState("");
  const targets = useQuery(trpc.exec.targets.queryOptions(scope));

  const rows = React.useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const all = targets.data ?? [];
    if (!needle) return all;
    return all.filter((row) =>
      `${row.name ?? ""} ${row.instanceId} ${row.privateIp ?? ""} ${row.publicIp ?? ""} ${row.instanceType ?? ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [targets.data, filter]);

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <Panel className="min-h-0 flex-1">
        <PanelHeader>
          <PanelTitle>Instances</PanelTitle>
          <span className="font-mono text-[11px] text-muted-foreground tabular">{rows.length}</span>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by name, id, address or type"
            className="ml-auto w-72 rounded-sm border border-border bg-transparent px-2 py-1 text-[12px] outline-none placeholder:text-muted-foreground focus:border-primary"
          />
        </PanelHeader>

        {targets.isPending ? (
          <LoadingRows rows={10} />
        ) : targets.isError ? (
          <ErrorState error={targets.error} onRetry={() => void targets.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Server}
            title="No instances"
            hint={`Nothing running in ${scope.region}`}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            {rows.map((row) => {
              const canSsm = row.reachableBy.includes("ssm");
              const canSsh = row.reachableBy.includes("ssh-public");
              const canTunnel = row.reachableBy.includes("ssh-ssm-tunnel");

              return (
                <div
                  key={row.instanceId}
                  className="flex items-center gap-3 border-b border-border/50 px-3.5 py-2 last:border-b-0"
                >
                  <div className="min-w-0 flex-[2]">
                    <p className="truncate text-[12.5px]">{row.name ?? row.instanceId}</p>
                    <p className="truncate font-mono text-[10.5px] text-muted-foreground">
                      {row.instanceId}
                    </p>
                  </div>

                  <div className="min-w-0 flex-1 font-mono text-[11px] text-muted-foreground">
                    <p className="truncate">{row.privateIp ?? "-"}</p>
                    {row.publicIp ? <p className="truncate">{row.publicIp}</p> : null}
                  </div>

                  <div className="min-w-0 flex-1 text-[11px] text-muted-foreground">
                    <p className="truncate">{row.instanceType ?? "-"}</p>
                    <p className="truncate">{row.availabilityZone ?? "-"}</p>
                  </div>

                  <Badge tone={row.state === "running" ? "success" : "neutral"}>{row.state}</Badge>
                  {row.ssmManaged ? (
                    <Badge tone={row.ssmPingStatus === "Online" ? "info" : "warning"}>
                      ssm {row.ssmPingStatus?.toLowerCase() ?? "?"}
                    </Badge>
                  ) : null}

                  <div className="flex shrink-0 items-center gap-1">
                    {canSsm ? (
                      <Button
                        onClick={() =>
                          open({
                            kind: "ssm",
                            profile: scope.profile,
                            region: scope.region,
                            instanceId: row.instanceId,
                          })
                        }
                        title="Session Manager shell - no key and no inbound rule needed"
                      >
                        <TerminalSquare className="size-3" /> Shell
                      </Button>
                    ) : null}

                    {canSsh ? (
                      <Button
                        variant="ghost"
                        onClick={() =>
                          open({
                            kind: "ssh",
                            transport: {
                              via: "ec2-instance-connect",
                              profile: scope.profile,
                              region: scope.region,
                              instanceId: row.instanceId,
                              osUser: row.osUser,
                            },
                          })
                        }
                        title={`SSH as ${row.osUser} with a one-time key from EC2 Instance Connect`}
                      >
                        SSH
                      </Button>
                    ) : canTunnel ? (
                      <Button
                        variant="ghost"
                        onClick={() =>
                          open({
                            kind: "ssh",
                            transport: {
                              via: "ssm-tunnel",
                              profile: scope.profile,
                              region: scope.region,
                              instanceId: row.instanceId,
                            },
                            user: row.osUser,
                          })
                        }
                        title={`SSH as ${row.osUser} over an SSM tunnel`}
                      >
                        SSH via SSM
                      </Button>
                    ) : null}

                    {row.reachableBy.length === 0 ? (
                      <span
                        className="text-[10.5px] text-muted-foreground"
                        title="No SSM agent, and no public address"
                      >
                        unreachable
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
