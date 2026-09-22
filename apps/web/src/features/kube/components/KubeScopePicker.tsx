import { useQuery } from "@tanstack/react-query";
import { Boxes, Check, Ship } from "lucide-react";
import * as React from "react";

import { useKubeScope } from "~/contexts/ScopeContext";
import { trpc } from "~/lib/trpc";
import { cn } from "~/lib/utils";

/**
 * Which context and namespace the Kubernetes pages are reading.
 *
 * It sits in these pages' own header rather than in the title bar, following
 * the rule `ConnectionPicker` states: a scope that moves only some pages must
 * not sit where it appears to scope the whole app. Here there is a second
 * reason on top of that one - the title bar holds profile and region, so
 * anything put beside them reads as AWS, and a Kubernetes context is the one
 * thing in this app that is emphatically not.
 */
export function KubeScopePicker() {
  const { context, namespace, setContext, setNamespace } = useKubeScope();
  const [open, setOpen] = React.useState<"context" | "namespace" | null>(null);

  const contexts = useQuery({ ...trpc.kube.contexts.queryOptions(), retry: false });
  const namespaces = useQuery({
    ...trpc.kube.namespaces.queryOptions({ context }),
    enabled: context.length > 0,
    retry: false,
  });

  if (contexts.isError || (contexts.isSuccess && contexts.data.length === 0)) return null;

  return (
    <div className="flex items-center gap-1.5">
      <Chip
        icon={Ship}
        label={context || "no context"}
        title="Which context these pages read"
        open={open === "context"}
        onToggle={() => setOpen((prev) => (prev === "context" ? null : "context"))}
      >
        {(contexts.data ?? []).map((entry) => (
          <Choice
            key={entry.name}
            label={entry.name}
            detail={entry.server ?? entry.clusterName}
            selected={entry.name === context}
            onSelect={() => {
              setContext(entry.name);
              setOpen(null);
            }}
          />
        ))}
      </Chip>

      <span aria-hidden className="text-muted-foreground/40">
        /
      </span>

      <Chip
        icon={Boxes}
        label={namespace}
        title="Which namespace these pages read"
        open={open === "namespace"}
        onToggle={() => setOpen((prev) => (prev === "namespace" ? null : "namespace"))}
      >
        {/* A role that can exec into a pod does not have to be allowed to list
            namespaces, so an empty list here is a normal cluster rather than a
            broken one - and the current namespace still works. */}
        {namespaces.data === undefined || namespaces.data.length === 0 ? (
          <p className="px-2 py-1.5 text-[11.5px] text-muted-foreground">
            {namespaces.isError
              ? "This context cannot list namespaces."
              : namespaces.isPending
                ? "Looking..."
                : "No namespaces to choose from."}
          </p>
        ) : (
          namespaces.data.map((entry) => (
            <Choice
              key={entry.name}
              label={entry.name}
              detail={entry.phase}
              selected={entry.name === namespace}
              onSelect={() => {
                setNamespace(entry.name);
                setOpen(null);
              }}
            />
          ))
        )}
      </Chip>
    </div>
  );
}

function Chip({
  icon: Icon,
  label,
  title,
  open,
  onToggle,
  children,
}: {
  icon: typeof Ship;
  label: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        title={title}
        className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Icon className="size-3.5 opacity-70" strokeWidth={1.8} />
        <span className="max-w-40 truncate text-[11.5px] text-foreground">{label}</span>
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close list"
            className="fixed inset-0 z-40 cursor-default"
            onClick={onToggle}
          />
          <div className="absolute top-8 left-0 z-50 max-h-80 w-72 overflow-auto rounded-lg border border-border bg-popover p-1 shadow-xl">
            {children}
          </div>
        </>
      ) : null}
    </div>
  );
}

function Choice({
  label,
  detail,
  selected,
  onSelect,
}: {
  label: string;
  detail: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-accent"
    >
      <Check className={cn("size-3 shrink-0", selected ? "text-primary" : "opacity-0")} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px]">{label}</span>
        <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
          {detail}
        </span>
      </span>
    </button>
  );
}
