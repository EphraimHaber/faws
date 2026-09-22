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
  disabledReason = null,
  className,
}: {
  name: Name;
  label: string;
  hint?: string;
  /**
   * Why this cannot be ticked right now. It replaces the hint, in the page
   * rather than in a tooltip, because a disabled input shows no tooltip.
   */
  disabledReason?: string | null;
  className?: string;
}) {
  const { field, fieldState } = useController<Values, Name>({ name });
  // A checkbox is driven by `checked`, so the registered `value` is pulled out
  // rather than spread onto the input.
  const { value: checked, ...control } = field;
  const id = React.useId();
  const disabled = disabledReason !== null;
  const note = disabledReason ?? hint;
  const hintId = note ? `${id}-hint` : undefined;
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
          disabled={disabled}
          onChange={(event) => field.onChange(event.target.checked)}
          aria-invalid={Boolean(fieldState.error)}
          aria-describedby={errorId ?? hintId}
          className="size-3.5 cursor-pointer accent-primary disabled:cursor-not-allowed"
        />
        <label
          htmlFor={id}
          className={cn(
            "text-[12.5px]",
            disabled
              ? "cursor-not-allowed text-muted-foreground"
              : "cursor-pointer text-foreground",
          )}
        >
          {label}
        </label>
      </div>

      {message ? (
        <p id={errorId} role="alert" className="text-[11.5px] text-danger">
          {message}
        </p>
      ) : note ? (
        <p id={hintId} className="pl-[22px] text-[11.5px] text-muted-foreground">
          {note}
        </p>
      ) : null}
    </div>
  );
}
