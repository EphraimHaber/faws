import * as React from "react";
import {
  useController,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";

import { cn } from "~/lib/utils";

/** What a control needs to render itself and be announced correctly. */
export interface FieldControlProps<Values extends FieldValues, Name extends FieldPath<Values>> {
  readonly field: ControllerRenderProps<Values, Name>;
  readonly id: string;
  readonly describedBy: string | undefined;
  readonly invalid: boolean;
}

export interface FormFieldProps<Values extends FieldValues, Name extends FieldPath<Values>> {
  readonly name: Name;
  readonly label: string;
  /** Sits under the control; also what `aria-describedby` points at. */
  readonly hint?: string;
  readonly className?: string;
  readonly children: (props: FieldControlProps<Values, Name>) => React.ReactNode;
}

/**
 * The label, control, hint and error of one field.
 *
 * Every control in this module renders through here, which is what keeps error
 * presentation and the `aria-invalid` / `aria-describedby` wiring decided in
 * one place rather than per dialog.
 */
export function FormField<Values extends FieldValues, Name extends FieldPath<Values>>({
  name,
  label,
  hint,
  className,
  children,
}: FormFieldProps<Values, Name>) {
  const { field, fieldState } = useController<Values, Name>({ name });
  const id = React.useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = fieldState.error ? `${id}-error` : undefined;
  const message = fieldState.error?.message;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label
        htmlFor={id}
        className="font-mono text-[9.5px] tracking-[0.18em] text-muted-foreground uppercase"
      >
        {label}
      </label>

      {children({
        field,
        id,
        // The error wins the description slot when both are present: while a
        // field is wrong, the rule it broke matters more than the hint.
        describedBy: errorId ?? hintId,
        invalid: Boolean(fieldState.error),
      })}

      {message ? (
        <p id={errorId} role="alert" className="text-[11.5px] text-danger">
          {message}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-[11.5px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Border and ring for a control, red once the field is invalid. */
export function controlClass(invalid: boolean, className?: string): string {
  return cn(invalid && "border-danger/60 focus:border-danger/60 focus:ring-danger/15", className);
}
