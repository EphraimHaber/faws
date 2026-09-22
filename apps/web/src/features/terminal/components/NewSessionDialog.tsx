import {
  type ExecInstanceTarget,
  kubeExecFormSchema,
  type KubeExecFormValues,
  sshSessionFormSchema,
  type SshSessionFormValues,
} from "@faws/contracts";
import { useQuery } from "@tanstack/react-query";
import { TerminalSquare } from "lucide-react";
import * as React from "react";

import {
  Form,
  FormActions,
  NumberField,
  SelectField,
  SubmitButton,
  TextField,
  useZodForm,
} from "~/components/form";
import { DialogFrame } from "~/components/Dialog";
import { EntityRow } from "~/components/entity-row";
import { ResourcePicker } from "~/components/ResourcePicker";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Segmented } from "~/components/segmented";
import { useAwsScope } from "~/contexts/ScopeContext";
import { instanceActions, instanceRef, sshHostRef } from "~/lib/terminal/connectable";
import { trpc } from "~/lib/trpc";
import { recentActions } from "~/stores/recents";
import { useSessions } from "~/stores/sessions";

type Mode = "instance" | "ssh" | "kube";

/**
 * Picking something to open a shell on.
 *
 * Three modes rather than one list, because they are genuinely different
 * questions. "Which of my instances" is a search over things the account
 * already knows about; "ssh somewhere" is an address someone types, and may not
 * be in AWS at all; and a pod is named inside a context and a namespace, which
 * is a scope AWS has no notion of. A single combined field would have to guess
 * which one an input meant.
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

  return (
    // Its own header rather than the shared `Dialog`'s: the mode switch belongs
    // in the title bar, beside the question it answers, and a picker opened at
    // a glance sits higher on the screen than a form read top to bottom.
    <DialogFrame
      id="terminal-new-session"
      label="Open a terminal"
      onClose={onClose}
      backdropClassName="items-start bg-black/40 pt-24"
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
              { value: "kube", label: "Pod" },
            ]}
          />
        </div>
      </div>
      {mode === "instance" ? (
        <InstancePicker onClose={onClose} />
      ) : mode === "ssh" ? (
        <SshForm onClose={onClose} />
      ) : (
        <KubeForm onClose={onClose} />
      )}
    </DialogFrame>
  );
}

function InstancePicker({ onClose }: { onClose: () => void }) {
  const scope = useAwsScope();
  const open = useSessions((state) => state.open);
  const targets = useQuery(trpc.exec.targets.queryOptions(scope));

  return (
    <ResourcePicker
      items={targets.data ?? []}
      pending={targets.isPending}
      keyOf={(row) => row.instanceId}
      text={instanceText}
      placeholder="Filter by name, id or address"
      pendingLabel="Looking for instances..."
      emptyLabel="No instances match."
      className="max-h-[22rem]"
    >
      {(row) => {
        return (
          <EntityRow
            className="gap-2.5 border-b border-border/50 px-3 last:border-b-0"
            label={row.name ?? row.instanceId}
            detail={`${row.instanceId}${row.privateIp ? ` - ${row.privateIp}` : ""}${
              row.instanceType ? ` - ${row.instanceType}` : ""
            }`}
            actions={
              <>
                <Badge tone={row.state === "running" ? "success" : "neutral"}>{row.state}</Badge>

                {row.reachableBy.length === 0 ? (
                  <span
                    className="text-[10.5px] text-muted-foreground"
                    title="No SSM agent, and no public address"
                  >
                    unreachable
                  </span>
                ) : null}

                {instanceActions(row, scope).map((action, index) => (
                  <Button
                    key={action.label}
                    variant={index === 0 ? "outline" : "ghost"}
                    title={action.title}
                    onClick={() => {
                      open(action.target);
                      recentActions.record(instanceRef(row, scope));
                      onClose();
                    }}
                  >
                    {action.label}
                  </Button>
                ))}
              </>
            }
          />
        );
      }}
    </ResourcePicker>
  );
}

/**
 * The four things someone might have in hand when looking for an instance.
 *
 * Declared out here so it is one value rather than one per render, which is
 * what keeps the ranking from being recomputed on every keystroke's re-render
 * of the dialog around it.
 */
function instanceText(row: ExecInstanceTarget): ReadonlyArray<string> {
  return [row.name ?? "", row.instanceId, row.privateIp ?? "", row.publicIp ?? ""];
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
    // On submit rather than on a dwell: a host that was typed out in full is
    // about as deliberate as an act in this app gets.
    recentActions.record(sshHostRef(values.host, values.user));
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
                  recentActions.record(sshHostRef(entry.host));
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

/**
 * Splits what someone typed into an argv.
 *
 * On whitespace and nothing else, deliberately. There is no shell between here
 * and the container, so a quoted string would have to be taken apart by a
 * quoting parser - and one that disagreed with the shell people expect would be
 * worse than not having one. A command that needs quoting is a command to run
 * from inside the shell this opens.
 */
function toArgv(command: string): string[] {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts : ["/bin/sh"];
}

/**
 * A pod, named rather than picked.
 *
 * Typed fields, because the Workloads page is where a pod is chosen from a
 * list. This is the way in for a name someone already has - from a colleague, a
 * runbook, or the `kubectl` they ran in the window next door.
 */
function KubeForm({ onClose }: { onClose: () => void }) {
  const open = useSessions((state) => state.open);
  const form = useZodForm(kubeExecFormSchema, {
    defaultValues: {
      tool: "kubectl",
      context: "",
      namespace: "default",
      pod: "",
      container: "",
      command: "/bin/sh",
    },
  });

  function submit(values: KubeExecFormValues) {
    const pod = {
      pod: values.pod,
      ...(values.container ? { container: values.container } : {}),
      command: toArgv(values.command),
    };
    open({
      kind: "kube",
      context: values.context,
      namespace: values.namespace,
      target: values.tool === "oc" ? { tool: "oc", ...pod } : { tool: "kubectl", ...pod },
    });
    onClose();
  }

  return (
    <Form form={form} onSubmit={submit} className="p-3">
      <div className="flex flex-wrap gap-3">
        <TextField
          name="context"
          label="Context"
          hint="A context from your kubeconfig"
          placeholder="prod"
          autoFocus
          mono
          className="w-64"
        />
        <TextField name="namespace" label="Namespace" placeholder="default" mono className="w-48" />
      </div>

      <div className="flex flex-wrap gap-3">
        <TextField name="pod" label="Pod" placeholder="api-7f9c4d8b6-x2k4p" mono className="w-64" />
        <TextField
          name="container"
          label="Container"
          hint="Blank picks the pod's default"
          mono
          className="w-48"
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <SelectField
          name="tool"
          label="Tool"
          hint="oc rsh is the same call, with OpenShift's login behind it"
          options={[
            { value: "kubectl", label: "kubectl exec" },
            { value: "oc", label: "oc rsh" },
          ]}
          className="w-36"
        />
        <TextField
          name="command"
          label="Command"
          hint="Split on spaces; there is no shell in between"
          mono
          className="w-64"
        />
      </div>

      <FormActions className="border-t border-border pt-3">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <SubmitButton>Connect</SubmitButton>
      </FormActions>
    </Form>
  );
}
