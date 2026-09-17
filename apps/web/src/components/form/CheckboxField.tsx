import * as React from "react";
import { useController, type FieldPath, type FieldValues } from "react-hook-form";

import { cn } from "~/lib/utils";

/**
 * A checkbox with its label to the right.
 *
 * It does not go through `FormField`: a stacked label above a box reads as a
 * heading for a group rather than as the name of the one thing being toggled.
 */
export function CheckboxField<Values extends FieldValues, Name extends FieldPath<Values>>({
  name,
  label,
  hint,
  className,
}: {
  name: Name;
  label: string;
  hint?: string;
  className?: string;
}) {
  const { field, fieldState } = useController<Values, Name>({ name });
  // A checkbox is driven by `checked`, so the registered `value` is pulled out
  // rather than spread onto the input.
  const { value: checked, ...control } = field;
  const id = React.useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = fieldState.error ? `${id}-error` : undefined;
  const message = fieldState.error?.message;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-2">
        <input
          {...control}
          id={id}
          type="checkbox"
          checked={Boolean(checked)}
          onChange={(event) => field.onChange(event.target.checked)}
          aria-invalid={Boolean(fieldState.error)}
          aria-describedby={errorId ?? hintId}
          className="size-3.5 cursor-pointer accent-primary"
        />
        <label htmlFor={id} className="cursor-pointer text-[12.5px] text-foreground">
          {label}
        </label>
      </div>

      {message ? (
        <p id={errorId} role="alert" className="text-[11.5px] text-danger">
          {message}
        </p>
      ) : hint ? (
        <p id={hintId} className="pl-[22px] text-[11.5px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
