import { s3DeleteObjectsSchema } from "@faws/contracts";
import { byteSize } from "@faws/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import {
  ConfirmTextField,
  Form,
  FormActions,
  FormError,
  SubmitButton,
  useZodForm,
} from "~/components/form";
import { Dialog } from "~/features/s3/components/Dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useS3Scope } from "~/contexts/ScopeContext";
import { trpc } from "~/lib/trpc";

/** Keys listed in full before the list is summarised instead. */
const NAMED_LIMIT = 8;

export interface DeleteTarget {
  readonly key: string;
  readonly size: number;
}

/**
 * Confirmation in front of a delete.
 *
 * One object is one click. More than one needs the bucket name typed, a rule
 * the schema enforces rather than the dialog, so it also holds for anything
 * that calls the API without rendering this.
 */
export function DeleteDialog({
  bucket,
  versioned,
  targets,
  onClose,
}: {
  bucket: string;
  /** A delete on a versioned bucket is recoverable; on any other it is not. */
  versioned: boolean | null;
  targets: ReadonlyArray<DeleteTarget>;
  onClose: () => void;
}) {
  const scope = useS3Scope();
  const queryClient = useQueryClient();
  const [failures, setFailures] = React.useState<ReadonlyArray<{ key: string; message: string }>>(
    [],
  );

  const form = useZodForm(s3DeleteObjectsSchema, {
    defaultValues: {
      bucket,
      objects: targets.map((target) => ({ key: target.key })),
      confirm: "",
    },
  });

  const remove = useMutation(
    trpc.s3Actions.deleteObjects.mutationOptions({
      onSuccess: (outcome) => {
        setFailures(outcome.errors.map((error) => ({ key: error.key, message: error.message })));
        void queryClient.invalidateQueries();
        // A partial failure is the one case worth staying open for: the list
        // of what survived is the whole answer.
        if (outcome.errors.length === 0) onClose();
      },
    }),
  );

  const totalBytes = targets.reduce((sum, target) => sum + target.size, 0);
  const single = targets.length === 1;

  return (
    <Dialog id="s3-delete" title={single ? "Delete object" : "Delete objects"} onClose={onClose}>
      <Form
        form={form}
        onSubmit={(values) => remove.mutate({ ...scope, ...values })}
        className="gap-3"
      >
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px]">
            {single ? "This object will be deleted." : null}
            {single ? null : (
              <>
                <span className="font-mono">{targets.length}</span> objects,{" "}
                <span className="font-mono">{byteSize(totalBytes)}</span> in total.
              </>
            )}
          </p>

          <ul className="max-h-40 overflow-auto rounded border border-border bg-background/40 p-2">
            {targets.slice(0, NAMED_LIMIT).map((target) => (
              <li key={target.key} className="truncate font-mono text-[11.5px]" title={target.key}>
                {target.key}
              </li>
            ))}
            {targets.length > NAMED_LIMIT ? (
              <li className="font-mono text-[11.5px] text-muted-foreground">
                and {targets.length - NAMED_LIMIT} more
              </li>
            ) : null}
          </ul>

          {versioned === null ? null : versioned ? (
            <p className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
              <Badge tone="info">versioned</Badge>
              This writes a delete marker; an earlier version can still be restored.
            </p>
          ) : (
            <p className="flex items-center gap-2 text-[11.5px] text-warning">
              <Badge tone="warning">not versioned</Badge>
              This cannot be undone.
            </p>
          )}
        </div>

        {single ? null : <ConfirmTextField name="confirm" expected={bucket} />}

        {failures.length > 0 ? (
          <div className="flex flex-col gap-1 rounded border border-danger/35 bg-danger/8 p-2">
            <p className="text-[11.5px] text-foreground">
              {failures.length} of {targets.length} could not be deleted:
            </p>
            {failures.slice(0, NAMED_LIMIT).map((failure) => (
              <p key={failure.key} className="truncate font-mono text-[11px] text-danger">
                {failure.key} — {failure.message}
              </p>
            ))}
          </div>
        ) : null}

        <FormError error={remove.error} />

        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton variant="danger" pending={remove.isPending}>
            Delete {single ? "object" : `${targets.length} objects`}
          </SubmitButton>
        </FormActions>
      </Form>
    </Dialog>
  );
}
