import { s3PutTagsSchema } from "@faws/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import {
  Form,
  FormActions,
  FormError,
  KeyValueField,
  pairsToRecord,
  recordToPairs,
  SubmitButton,
  useZodForm,
} from "~/components/form";
import { Dialog } from "~/features/s3/components/Dialog";
import { Button } from "~/components/ui/button";
import { useS3Scope } from "~/contexts/ScopeContext";
import { trpc } from "~/lib/trpc";

/**
 * Tags as rows rather than as the object the API takes.
 *
 * A record cannot hold two drafts of the same key, and renaming one in place
 * would drop its value the moment it collided with another. The rows are the
 * editing shape; `pairsToRecord` produces what is sent, and the contract
 * schema is what validates it on arrival.
 */
const tagRowsSchema = z.object({
  rows: z
    .array(z.object({ key: z.string().max(128), value: z.string().max(256) }))
    // The service's own ceiling, so the form says no before the API does.
    .max(10, "An object carries at most ten tags."),
});

export function TagEditor({
  bucket,
  objectKey,
  tags,
  onClose,
}: {
  bucket: string;
  objectKey: string;
  tags: Readonly<Record<string, string>>;
  onClose: () => void;
}) {
  const scope = useS3Scope();
  const queryClient = useQueryClient();

  const form = useZodForm(tagRowsSchema, { defaultValues: { rows: recordToPairs(tags) } });

  const save = useMutation(
    trpc.s3Actions.putTags.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries();
        onClose();
      },
    }),
  );

  return (
    <Dialog id="s3-tags" title="Tags" onClose={onClose}>
      <Form
        form={form}
        onSubmit={(values) => {
          // Parsed against the shared contract before it is sent, so the rule
          // the server enforces is the one the dialog reports.
          const input = s3PutTagsSchema.safeParse({
            bucket,
            key: objectKey,
            tags: pairsToRecord(values.rows),
          });
          if (!input.success) {
            form.setError("rows", { message: input.error.issues[0]?.message ?? "Invalid tags." });
            return;
          }
          save.mutate({ ...scope, ...input.data });
        }}
      >
        <p className="truncate font-mono text-[11.5px] text-muted-foreground" title={objectKey}>
          {objectKey}
        </p>

        <KeyValueField
          name="rows"
          label="Tags"
          max={10}
          keyPlaceholder="name"
          valuePlaceholder="value"
          hint="A row with no name is dropped."
        />

        <FormError error={save.error} />

        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton pending={save.isPending}>Save tags</SubmitButton>
        </FormActions>
      </Form>
    </Dialog>
  );
}
