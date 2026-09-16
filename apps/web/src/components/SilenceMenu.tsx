import type { EcsService } from "@faws/contracts";
import { BellOff, Check, X } from "lucide-react";
import * as React from "react";

import { serviceFingerprint, useSilenced } from "~/stores/silenced";
import { cn } from "~/lib/utils";

/**
 * The control for making a warning go away.
 *
 * Offering both options at the point of annoyance matters: dismissing a
 * one-off and muting another team's service look identical in the moment, and
 * an operator who is only offered the permanent one will reach for it and then
 * miss a real incident later.
 */
export function SilenceMenu({ service, className }: { service: EcsService; className?: string }) {
  const dismiss = useSilenced((state) => state.dismiss);
  const mute = useSilenced((state) => state.mute);
  const [open, setOpen] = React.useState(false);

  const context = `${service.clusterName} · ${
    service.rolloutState === "FAILED"
      ? "rollout failed"
      : service.failedTasks > 0
        ? `${service.failedTasks} failed tasks`
        : service.deploymentState
  }`;

  return (
    <span className={cn("relative", className)}>
      <button
        type="button"
        aria-label={`Silence warnings for ${service.name}`}
        title="Not yours? Dismiss or mute this warning"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className="grid size-5 cursor-pointer place-items-center rounded text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="size-3" strokeWidth={2.2} />
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-40 cursor-default"
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
            }}
          />
          <div className="absolute top-6 right-0 z-50 w-72 rounded-lg border border-border bg-popover p-1 shadow-xl">
            <MenuItem
              icon={Check}
              title="Dismiss this failure"
              detail="Comes back if the service fails again in a new way."
              onClick={(event) => {
                event.stopPropagation();
                dismiss({
                  arn: service.arn,
                  label: service.name,
                  context,
                  fingerprint: serviceFingerprint(service),
                });
                setOpen(false);
              }}
            />
            <MenuItem
              icon={BellOff}
              title="Mute this service"
              detail="Hides every warning from it until you restore it in Settings."
              onClick={(event) => {
                event.stopPropagation();
                mute({ arn: service.arn, label: service.name, context });
                setOpen(false);
              }}
            />
          </div>
        </>
      ) : null}
    </span>
  );
}

function MenuItem({
  icon: Icon,
  title,
  detail,
  onClick,
}: {
  icon: typeof Check;
  title: string;
  detail: string;
  onClick: (event: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-start gap-2.5 rounded px-2.5 py-2 text-left transition-colors hover:bg-accent"
    >
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.9} />
      <span className="min-w-0">
        <span className="block text-[12.5px]">{title}</span>
        <span className="block text-[11px] text-muted-foreground">{detail}</span>
      </span>
    </button>
  );
}

/**
 * The counterweight to hiding things: every surface that filters says how many
 * it hid and offers them back. A silently shortened list is worse than a noisy
 * one.
 */
export function HiddenCount({
  count,
  onReveal,
  revealed,
}: {
  count: number;
  onReveal: () => void;
  revealed: boolean;
}) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={onReveal}
      className="cursor-pointer font-mono text-[10.5px] text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground"
    >
      {revealed ? "hide" : `${count} silenced`}
    </button>
  );
}
