import { s3CopyObjectSchema } from "@faws/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  CheckboxField,
  Form,
  FormActions,
  FormError,
  SubmitButton,
  TextField,
  useZodForm,
} from "~/components/form";
import { Dialog } from "~/features/s3/components/Dialog";
import { Button } from "~/components/ui/button";
import { useS3Scope } from "~/contexts/ScopeContext";
import { trpc } from "~/lib/trpc";

/**
 * Copying an object, or moving it.
 *
 * A move is the same form with the source deleted afterwards, because that is
 * what a move is here: S3 has no rename, and pretending otherwise hides which
 * half failed when one of them does.
 */
export function CopyMoveDialog({
  bucket,
  sourceKey,
  onClose,
}: {
  bucket: string;
  sourceKey: string;
  onClose: () => void;
}) {
  const scope = useS3Scope();
  const queryClient = useQueryClient();

  const form = useZodForm(s3CopyObjectSchema, {
    defaultValues: {
      sourceBucket: bucket,
      sourceKey,
      destBucket: bucket,
      destKey: sourceKey,
      deleteSource: false,
      overwrite: false,
    },
  });

  const copy = useMutation(
    trpc.s3Actions.copyObject.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries();
        onClose();
      },
    }),
  );

  const moving = form.watch("deleteSource");

  return (
    <Dialog id="s3-copy" title={moving ? "Move object" : "Copy object"} onClose={onClose}>
      <Form form={form} onSubmit={(values) => copy.mutate({ ...scope, ...values })}>
        <p className="truncate font-mono text-[11.5px] text-muted-foreground" title={sourceKey}>
          {sourceKey}
        </p>

        <TextField name="destBucket" label="Destination bucket" mono />
        <TextField name="destKey" label="Destination key" mono autoFocus />
        <CheckboxField
          name="deleteSource"
          label="Delete the original once the copy succeeds"
          hint="The copy is confirmed first, so a failure leaves the original where it is."
        />
        <CheckboxField
          name="overwrite"
          label="Replace the destination if it already exists"
          hint="Without this the write is refused rather than overwriting anything."
        />

        <FormError error={copy.error} />

        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton variant={moving ? "danger" : "default"} pending={copy.isPending}>
            {moving ? "Move" : "Copy"}
          </SubmitButton>
        </FormActions>
      </Form>
    </Dialog>
  );
}
