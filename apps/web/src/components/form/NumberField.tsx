import type { FieldPath, FieldValues } from "react-hook-form";

import { controlClass, FormField } from "~/components/form/FormField";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

export function NumberField<Values extends FieldValues, Name extends FieldPath<Values>>({
  name,
  label,
  hint,
  min,
  max,
  step,
  placeholder,
  className,
}: {
  name: Name;
  label: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  className?: string;
}) {
  return (
    <FormField<Values, Name> name={name} label={label} {...(hint ? { hint } : {})}>
      {({ field, id, describedBy, invalid }) => (
        <Input
          {...field}
          id={id}
          type="number"
          inputMode="numeric"
          value={(field.value as number | string | undefined) ?? ""}
          onChange={(event) => {
            // An empty box is absent, not zero: coercing it would silently
            // submit a value nobody typed.
            const raw = event.target.value;
            field.onChange(raw === "" ? undefined : Number(raw));
          }}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          {...(min === undefined ? {} : { min })}
          {...(max === undefined ? {} : { max })}
          {...(step === undefined ? {} : { step })}
          {...(placeholder ? { placeholder } : {})}
          className={controlClass(invalid, cn("font-mono tabular", className))}
        />
      )}
    </FormField>
  );
}
