import { sshSessionFormSchema, type SshSessionFormValues } from "@faws/contracts";
import { useQuery } from "@tanstack/react-query";
import { Search, TerminalSquare } from "lucide-react";
import * as React from "react";

import {
  Form,
  FormActions,
  NumberField,
  SubmitButton,
  TextField,
  useZodForm,
} from "~/components/form";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Segmented } from "~/components/segmented";
import { useAwsScope } from "~/contexts/ScopeContext";
import { trpc } from "~/lib/trpc";
import { useOverlay } from "~/stores/overlays";
import { useSessions } from "~/stores/sessions";

type Mode = "instance" | "ssh";

/**
 * Picking something to open a shell on.
 *
 * Two modes rather than one list, because the two are genuinely different
 * questions. "Which of my instances" is a search over things the account
 * already knows about; "ssh somewhere" is an address someone types, and may not
 * be in AWS at all. A single combined field would have to guess which one an
 * input meant.
 */
export function NewSessionDialog({
  open,
  onClose,
  initialMode = "instance",
}: {
  open: boolean;
  onClose: () => void;
  /** Which half to land on, so "SSH to a host" does not open on the instance list. */
  initialMode?: Mode;
}) {
  // Mounting the body only while open is what makes the entry point decide
  // which half opens: the state starts fresh each time rather than keeping
  // whichever half was last looked at.
  if (!open) return null;
  return <DialogBody onClose={onClose} initialMode={initialMode} />;
}

function DialogBody({ onClose, initialMode }: { onClose: () => void; initialMode: Mode }) {
  const [mode, setMode] = React.useState<Mode>(initialMode);
  // Open for as long as this body is mounted, which is the whole point of
  // mounting it conditionally.
  const { isTop } = useOverlay("terminal-new-session", true);

  React.useEffect(() => {
    if (!isTop) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isTop, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Open a terminal"
        className="w-[min(46rem,92vw)] overflow-hidden rounded-md border border-border bg-card shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <TerminalSquare className="size-3.5 text-muted-foreground" />
          <span className="text-[12.5px] font-medium">Open a terminal</span>
          <div className="ml-auto">
            <Segmented
              value={mode}
              onChange={(next) => setMode(next as Mode)}
              options={[
                { value: "instance", label: "Instance" },
                { value: "ssh", label: "SSH" },
              ]}
            />
          </div>
        </div>
        {mode === "instance" ? <InstancePicker onClose={onClose} /> : <SshForm onClose={onClose} />}
      </div>
    </div>
  );
}

function InstancePicker({ onClose }: { onClose: () => void }) {
  const scope = useAwsScope();
  const open = useSessions((state) => state.open);
  const [filter, setFilter] = React.useState("");
  const targets = useQuery(trpc.exec.targets.queryOptions(scope));

  const rows = React.useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const all = targets.data ?? [];
    if (!needle) return all;
    return all.filter((row) =>
      `${row.name ?? ""} ${row.instanceId} ${row.privateIp ?? ""} ${row.publicIp ?? ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [targets.data, filter]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <Search className="size-3 text-muted-foreground" />
        <input
          autoFocus
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter by name, id or address"
          className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div className="max-h-[22rem] overflow-auto">
        {targets.isPending ? (
          <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">
            Looking for instances...
          </p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">
            No instances match.
          </p>
        ) : (
          rows.map((row) => {
            const canSsm = row.reachableBy.includes("ssm");
            const canSsh = row.reachableBy.includes("ssh-public");
            const canTunnel = row.reachableBy.includes("ssh-ssm-tunnel");
            const unreachable = row.reachableBy.length === 0;

            return (
              <div
                key={row.instanceId}
                className="flex items-center gap-2.5 border-b border-border/50 px-3 py-2 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px]">{row.name ?? row.instanceId}</p>
                  <p className="truncate font-mono text-[10.5px] text-muted-foreground">
                    {row.instanceId}
                    {row.privateIp ? ` - ${row.privateIp}` : ""}
                    {row.instanceType ? ` - ${row.instanceType}` : ""}
                  </p>
                </div>
                <Badge tone={row.state === "running" ? "success" : "neutral"}>{row.state}</Badge>

                {unreachable ? (
                  <span
                    className="text-[10.5px] text-muted-foreground"
                    title="No SSM agent, and no public address"
                  >
                    unreachable
                  </span>
                ) : null}

                {canSsm ? (
                  <Button
                    onClick={() => {
                      open({
                        kind: "ssm",
                        profile: scope.profile,
                        region: scope.region,
                        instanceId: row.instanceId,
                      });
                      onClose();
                    }}
                    title="Session Manager shell - no key and no inbound rule needed"
                  >
                    Shell
                  </Button>
                ) : null}

                {/* Instance Connect pushes a key valid for about a minute, so
                    it only makes sense where SSH can actually reach. */}
                {canSsh ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      open({
                        kind: "ssh",
                        transport: {
                          via: "ec2-instance-connect",
                          profile: scope.profile,
                          region: scope.region,
                          instanceId: row.instanceId,
                          osUser: row.osUser,
                        },
                      });
                      onClose();
                    }}
                    title="SSH with a one-time key pushed by EC2 Instance Connect"
                  >
                    SSH
                  </Button>
                ) : canTunnel ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      open({
                        kind: "ssh",
                        transport: {
                          via: "ssm-tunnel",
                          profile: scope.profile,
                          region: scope.region,
                          instanceId: row.instanceId,
                        },
                        user: row.osUser,
                      });
                      onClose();
                    }}
                    title="SSH carried over an SSM tunnel - works without a public address"
                  >
                    SSH via SSM
                  </Button>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function SshForm({ onClose }: { onClose: () => void }) {
  const open = useSessions((state) => state.open);
  // Aliases the user already has. A Host entry carries its own user, port and
  // ProxyJump, so picking one connects with all of that applied rather than
  // making them retype it here.
  const hosts = useQuery(trpc.exec.sshHosts.queryOptions());
  // The same schema the handshake is ultimately built from, so a rule about
  // what a port may be is written once rather than once per side.
  const form = useZodForm(sshSessionFormSchema, {
    defaultValues: { host: "", user: "", port: 22 },
  });

  function submit(values: SshSessionFormValues) {
    open({
      kind: "ssh",
      transport: { via: "direct", host: values.host },
      ...(values.user ? { user: values.user } : {}),
      ...(values.port === 22 ? {} : { port: values.port }),
    });
    onClose();
  }

  const saved = hosts.data ?? [];

  return (
    <Form form={form} onSubmit={submit} className="p-3">
      {saved.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] text-muted-foreground">From your ~/.ssh/config</p>
          <div className="flex max-h-28 flex-wrap gap-1.5 overflow-auto">
            {saved.map((entry) => (
              <button
                key={entry.host}
                type="button"
                onClick={() => {
                  open({ kind: "ssh", transport: { via: "direct", host: entry.host } });
                  onClose();
                }}
                title={`ssh ${entry.host} (${entry.hostName})`}
                className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[11px] hover:border-primary hover:text-primary"
              >
                {entry.host}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <TextField
        name="host"
        label="Host"
        hint="A hostname, or a Host entry from your ~/.ssh/config"
        placeholder="bastion.example.com"
        autoFocus
        className="w-64"
      />

      <TextField
        name="user"
        label="User"
        hint="Blank lets ~/.ssh/config decide"
        placeholder="ubuntu"
        className="w-64"
      />

      <NumberField name="port" label="Port" min={1} max={65535} className="w-24" />

      <FormActions className="border-t border-border pt-3">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <SubmitButton>Connect</SubmitButton>
      </FormActions>
    </Form>
  );
}
