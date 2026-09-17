import type { FieldPath, FieldValues } from "react-hook-form";

import { controlClass, FormField } from "~/components/form/FormField";
import { cn } from "~/lib/utils";

export function TextAreaField<Values extends FieldValues, Name extends FieldPath<Values>>({
  name,
  label,
  hint,
  placeholder,
  rows = 4,
  mono = true,
  className,
}: {
  name: Name;
  label: string;
  hint?: string;
  placeholder?: string;
  rows?: number;
  mono?: boolean;
  className?: string;
}) {
  return (
    <FormField<Values, Name> name={name} label={label} {...(hint ? { hint } : {})}>
      {({ field, id, describedBy, invalid }) => (
        <textarea
          {...field}
          id={id}
          rows={rows}
          value={(field.value as string | undefined) ?? ""}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          spellCheck={!mono}
          {...(placeholder ? { placeholder } : {})}
          className={controlClass(
            invalid,
            cn(
              "w-full resize-y rounded-md border border-border bg-card/60 px-2.5 py-1.5 text-[12.5px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/15",
              mono && "font-mono text-[12px]",
              className,
            ),
          )}
        />
      )}
    </FormField>
  );
}
