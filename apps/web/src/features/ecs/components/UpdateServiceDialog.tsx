import type { EcsService } from "@faws/contracts";
import { updateServiceSchema } from "@faws/contracts";
import { useHotkeys } from "@tanstack/react-hotkeys";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as React from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Kbd } from "~/components/ui/kbd";
import { useAwsScope } from "~/contexts/ScopeContext";
import { trpc } from "~/lib/trpc";
import { useOverlay } from "~/stores/overlays";
import { cn } from "~/lib/utils";

/**
 * The e1s "update service" flow: desired count, task definition revision,
 * force a new deployment.
 *
 * Validation comes from `updateServiceSchema` in `@faws/contracts` — the same
 * object the tRPC procedure validates with, including the cross-field rule
 * that at least one thing must actually change.
 */
export function UpdateServiceDialog({
  service,
  open,
  onClose,
}: {
  service: EcsService;
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return <UpdateServiceForm service={service} onClose={onClose} />;
}

function UpdateServiceForm({ service, onClose }: { service: EcsService; onClose: () => void }) {
  const scope = useAwsScope();
  const { isTop } = useOverlay("update-service", true);

  useHotkeys(
    [
      {
        hotkey: "Escape",
        callback: onClose,
        // `ignoreInputs: false` so it still cancels from inside a field, which
        // is where the cursor is for the whole life of this dialog.
        options: { enabled: isTop, ignoreInputs: false, conflictBehavior: "allow" },
      },
    ],
    { preventDefault: true },
  );

  const revisions = useQuery({
    ...trpc.ecs.taskDefinitionRevisions.queryOptions({
      ...scope,
      family: service.taskDefinitionFamily,
    }),
    staleTime: 30_000,
  });

  const updateService = useMutation(trpc.ecsActions.updateService.mutationOptions());

  const form = useForm({
    defaultValues: {
      desiredCount: service.desiredCount,
      taskDefinition: service.taskDefinition,
      forceNewDeployment: false,
    },
    validators: {
      // The schema also owns the cluster/service identity, which the form
      // doesn't edit — so it validates against the full payload.
      onChange: ({ value }) =>
        toFormErrors(
          updateServiceSchema.safeParse({
            cluster: service.clusterName,
            service: service.name,
            ...changedFields(service, value),
          }),
        ),
    },
    onSubmit: async ({ value }) => {
      await updateService.mutateAsync({
        ...scope,
        cluster: service.clusterName,
        service: service.name,
        ...changedFields(service, value),
      });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[2px]">
      <button
        type="button"
        aria-label="Cancel"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
        className="relative w-[min(460px,92vw)] rounded-xl border border-border bg-popover p-5 shadow-2xl"
      >
        <h2 className="text-[14px] font-semibold">Update service</h2>
        <p className="mt-0.5 mb-4 font-mono text-[11.5px] text-muted-foreground">
          {service.clusterName} / {service.name}
        </p>

        <div className="flex flex-col gap-3.5">
          <form.Field name="desiredCount">
            {(field) => (
              <Labelled
                label="Desired count"
                hint={`currently ${service.desiredCount}, ${service.runningCount} running`}
              >
                <Input
                  type="number"
                  min={0}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.valueAsNumber)}
                  className="w-24"
                />
              </Labelled>
            )}
          </form.Field>

          <form.Field name="taskDefinition">
            {(field) => (
              <Labelled label="Task definition" hint={service.taskDefinitionFamily}>
                <select
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  className="h-7 rounded-md border border-border bg-card/60 px-2 font-mono text-[12px] focus:border-primary/50 focus:outline-none"
                >
                  {(revisions.data ?? []).map((arn) => {
                    const label = arn.slice(arn.lastIndexOf("/") + 1);
                    return (
                      <option key={arn} value={label}>
                        {label}
                      </option>
                    );
                  })}
                  {revisions.isPending ? <option>loading…</option> : null}
                </select>
              </Labelled>
            )}
          </form.Field>

          <form.Field name="forceNewDeployment">
            {(field) => (
              <label className="flex cursor-pointer items-center gap-2 text-[12.5px]">
                <input
                  type="checkbox"
                  checked={field.state.value}
                  onChange={(event) => field.handleChange(event.target.checked)}
                  className="size-3.5 accent-[var(--primary)]"
                />
                Force new deployment
              </label>
            )}
          </form.Field>
        </div>

        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting, state.errorMap]}>
          {([canSubmit, isSubmitting, errorMap]) => {
            const validation = firstError(errorMap as Record<string, unknown>);
            const failure = updateService.error;
            return (
              <>
                {validation || failure ? (
                  <p
                    className={cn(
                      "mt-3.5 rounded-md border px-2.5 py-1.5 font-mono text-[11.5px]",
                      failure
                        ? "border-danger/30 bg-danger/8 text-danger"
                        : "border-warning/30 bg-warning/8 text-warning",
                    )}
                  >
                    {failure instanceof Error ? failure.message : validation}
                  </p>
                ) : null}

                <div className="mt-4 flex items-center justify-end gap-2">
                  <Kbd className="mr-auto">esc</Kbd>
                  <Button type="button" variant="ghost" size="md" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="default"
                    size="md"
                    disabled={!(canSubmit as boolean) || (isSubmitting as boolean)}
                  >
                    {isSubmitting ? "Updating…" : "Update service"}
                  </Button>
                </div>
              </>
            );
          }}
        </form.Subscribe>
      </form>
    </div>
  );
}

type FormValues = {
  desiredCount: number;
  taskDefinition: string;
  forceNewDeployment: boolean;
};

/**
 * Only fields the user actually moved are sent. ECS treats an omitted field as
 * "leave it alone", and sending the current value back would still count as a
 * change for the schema's "something must differ" rule.
 */
function changedFields(service: EcsService, values: FormValues) {
  return {
    ...(values.desiredCount === service.desiredCount ? {} : { desiredCount: values.desiredCount }),
    ...(values.taskDefinition === service.taskDefinition
      ? {}
      : { taskDefinition: values.taskDefinition }),
    ...(values.forceNewDeployment ? { forceNewDeployment: true } : {}),
  };
}

function toFormErrors(result: ReturnType<typeof updateServiceSchema.safeParse>) {
  if (result.success) return undefined;
  return { form: result.error.issues[0]?.message ?? "Invalid input", fields: {} };
}

function firstError(errorMap: Record<string, unknown>): string | null {
  for (const value of Object.values(errorMap)) {
    if (typeof value === "string" && value.length > 0) return value;
    if (value && typeof value === "object" && "form" in value) {
      const form = (value as { form?: unknown }).form;
      if (typeof form === "string" && form.length > 0) return form;
    }
  }
  return null;
}

function Labelled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px]">{label}</p>
        {hint ? <p className="font-mono text-[10.5px] text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}
