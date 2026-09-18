import type { FieldPath, FieldValues } from "react-hook-form";

import { controlClass, FormField } from "~/components/form/FormField";
import { cn } from "~/lib/utils";

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export function SelectField<Values extends FieldValues, Name extends FieldPath<Values>>({
  name,
  label,
  hint,
  options,
  placeholder,
  className,
}: {
  name: Name;
  label: string;
  hint?: string;
  options: ReadonlyArray<SelectOption>;
  /** Rendered as a disabled first entry, so "nothing picked" is visible. */
  placeholder?: string;
  className?: string;
}) {
  return (
    <FormField<Values, Name> name={name} label={label} {...(hint ? { hint } : {})}>
      {({ field, id, describedBy, invalid }) => (
        <select
          {...field}
          id={id}
          value={(field.value as string | undefined) ?? ""}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className={controlClass(
            invalid,
            cn(
              "h-7 w-full rounded-md border border-border bg-card/60 px-2 text-[12.5px] text-foreground focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/15",
              className,
            ),
          )}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled ?? false}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );
}
