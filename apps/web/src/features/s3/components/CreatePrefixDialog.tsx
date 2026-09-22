import { s3CreatePrefixSchema } from "@faws/contracts";
import { joinKey } from "@faws/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  Form,
  FormActions,
  FormError,
  SubmitButton,
  TextField,
  useZodForm,
} from "~/components/form";
import { Dialog } from "~/components/Dialog";
import { Button } from "~/components/ui/button";
import { useS3Scope } from "~/contexts/ScopeContext";
import { trpc } from "~/lib/trpc";

/**
 * A new folder.
 *
 * S3 has no folders, so this writes the zero byte object whose key ends in a
 * slash that every tool agrees to read as one. It exists so a prefix can be
 * seen before anything has been put in it.
 */
export function CreatePrefixDialog({
  bucket,
  parentPrefix,
  onClose,
}: {
  bucket: string;
  parentPrefix: string;
  onClose: () => void;
}) {
  const scope = useS3Scope();
  const queryClient = useQueryClient();

  const form = useZodForm(s3CreatePrefixSchema, {
    defaultValues: { bucket, prefix: parentPrefix },
  });

  const create = useMutation(
    trpc.s3Actions.createPrefix.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries();
        onClose();
      },
    }),
  );

  return (
    <Dialog id="s3-prefix" title="New folder" onClose={onClose}>
      <Form
        form={form}
        onSubmit={(values) =>
          create.mutate({
            ...scope,
            bucket: values.bucket,
            // Typed as a name inside the prefix that is open, which is what
            // the field shows, so the parent is put back on here.
            prefix: values.prefix.startsWith(parentPrefix)
              ? values.prefix
              : joinKey(parentPrefix, values.prefix),
          })
        }
      >
        <TextField
          name="prefix"
          label="Prefix"
          hint="A trailing slash is added if it is missing."
          mono
          autoFocus
        />

        <FormError error={create.error} />

        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton pending={create.isPending}>Create</SubmitButton>
        </FormActions>
      </Form>
    </Dialog>
  );
}
