import type { FieldPath, FieldValues } from "react-hook-form";

import { controlClass, FormField } from "~/components/form/FormField";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

export function TextField<Values extends FieldValues, Name extends FieldPath<Values>>({
  name,
  label,
  hint,
  placeholder,
  autoFocus,
  mono = false,
  className,
}: {
  name: Name;
  label: string;
  hint?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Keys, ARNs and bucket names are read character by character. */
  mono?: boolean;
  className?: string;
}) {
  return (
    <FormField<Values, Name> name={name} label={label} {...(hint ? { hint } : {})}>
      {({ field, id, describedBy, invalid }) => (
        <Input
          {...field}
          id={id}
          value={(field.value as string | undefined) ?? ""}
          autoFocus={autoFocus}
          spellCheck={!mono}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={invalid}
          aria-describedby={describedBy}
          {...(placeholder ? { placeholder } : {})}
          className={controlClass(invalid, cn(mono && "font-mono", className))}
        />
      )}
    </FormField>
  );
}
