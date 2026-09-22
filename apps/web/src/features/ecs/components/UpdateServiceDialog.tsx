import type { EcsService, UpdateServiceFormValues } from "@faws/contracts";
import { updateServiceFormSchema } from "@faws/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as React from "react";

import {
  CheckboxField,
  Form,
  FormActions,
  FormError,
  NumberField,
  SelectField,
  SubmitButton,
  useZodForm,
} from "~/components/form";
import { DialogFrame } from "~/components/Dialog";
import { Button } from "~/components/ui/button";
import { Kbd } from "~/components/ui/kbd";
import { useAwsScope } from "~/contexts/ScopeContext";
import { trpc } from "~/lib/trpc";

/**
 * The e1s "update service" flow: desired count, task definition revision,
 * force a new deployment.
 *
 * Validation comes from `updateServiceFormSchema` in `@faws/contracts`,
 * including the cross-field rule that at least one thing must actually change.
 * That rule needs the service's current values to judge against, which is why
 * the schema is a factory rather than a constant.
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

  const revisions = useQuery({
    ...trpc.ecs.taskDefinitionRevisions.queryOptions({
      ...scope,
      family: service.taskDefinitionFamily,
    }),
    staleTime: 30_000,
  });

  const updateService = useMutation(trpc.ecsActions.updateService.mutationOptions());

  const schema = React.useMemo(
    () =>
      updateServiceFormSchema({
        desiredCount: service.desiredCount,
        taskDefinition: service.taskDefinition,
      }),
    [service.desiredCount, service.taskDefinition],
  );

  const form = useZodForm(schema, {
    defaultValues: {
      desiredCount: service.desiredCount,
      taskDefinition: service.taskDefinition,
      forceNewDeployment: false,
    },
  });

  const options = React.useMemo(
    () =>
      (revisions.data ?? []).map((arn) => {
        const label = arn.slice(arn.lastIndexOf("/") + 1);
        return { value: label, label };
      }),
    [revisions.data],
  );

  async function submit(values: UpdateServiceFormValues) {
    await updateService.mutateAsync({
      ...scope,
      cluster: service.clusterName,
      service: service.name,
      ...changedFields(service, values),
    });
    onClose();
  }

  return (
    // Centred and narrow, unlike the S3 dialogs: this is three fields read in
    // order and answered, not a browser you work inside.
    <DialogFrame
      id="update-service"
      label="Update service"
      onClose={onClose}
      backdropClassName="items-center bg-black/45 backdrop-blur-[2px]"
      className="w-[min(460px,92vw)] rounded-xl border border-border bg-popover p-5 shadow-2xl"
    >
      <Form form={form} onSubmit={submit}>
        <div>
          <h2 className="text-[14px] font-semibold">Update service</h2>
          <p className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">
            {service.clusterName} / {service.name}
          </p>
        </div>

        <NumberField
          name="desiredCount"
          label="Desired count"
          hint={`currently ${service.desiredCount}, ${service.runningCount} running`}
          min={0}
          max={5000}
          className="w-24"
        />

        <SelectField
          name="taskDefinition"
          label="Task definition"
          hint={revisions.isPending ? "loading revisions…" : service.taskDefinitionFamily}
          options={options}
        />

        <CheckboxField name="forceNewDeployment" label="Force new deployment" />

        {/* Two different refusals, and both have to be visible. The schema's
            cross-field rule ("change something") has no field to attach to, so
            it lands on the form root; the mutation's own failure is separate.
            Dropping either leaves a button that silently does nothing. */}
        <FormError error={form.formState.errors.root?.message ?? updateService.error} />

        <FormActions>
          <Kbd className="mr-auto">esc</Kbd>
          <Button type="button" variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton variant="default" size="md">
            Update service
          </SubmitButton>
        </FormActions>
      </Form>
    </DialogFrame>
  );
}

/**
 * Only fields the user actually moved are sent. ECS treats an omitted field as
 * "leave it alone", and sending the current value back would still count as a
 * change for the schema's "something must differ" rule.
 */
function changedFields(service: EcsService, values: UpdateServiceFormValues) {
  return {
    ...(values.desiredCount === service.desiredCount ? {} : { desiredCount: values.desiredCount }),
    ...(values.taskDefinition === service.taskDefinition
      ? {}
      : { taskDefinition: values.taskDefinition }),
    ...(values.forceNewDeployment ? { forceNewDeployment: true } : {}),
  };
}
