import { Check } from "lucide-react";
import { useWatch, type FieldPath, type FieldValues } from "react-hook-form";

import { confirmMatches } from "~/components/form/confirm";
import { controlClass, FormField } from "~/components/form/FormField";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

/**
 * The "type the name to continue" gate in front of an irreversible action.
 *
 * Whether the entry is accepted is decided by the schema, not here, so the
 * same rule holds for a caller that submits without ever rendering this field.
 * What the field adds is the thing a schema cannot: the name in front of you
 * while you copy it, and a tick the moment it matches.
 */
export function ConfirmTextField<Values extends FieldValues, Name extends FieldPath<Values>>({
  name,
  expected,
  label = "Confirm",
  className,
}: {
  name: Name;
  /** The exact string that must be typed, shown so it can be read off. */
  expected: string;
  label?: string;
  className?: string;
}) {
  const typed = useWatch<Values>({ name }) as string | undefined;
  const matched = confirmMatches(expected, typed);

  return (
    <FormField<Values, Name> name={name} label={label} {...(className ? { className } : {})}>
      {({ field, id, describedBy, invalid }) => (
        <div className="flex flex-col gap-1">
          <p className="text-[11.5px] text-muted-foreground">
            Type <span className="font-mono text-foreground">{expected}</span> to continue.
          </p>
          <div className="relative">
            <Input
              {...field}
              id={id}
              value={(field.value as string | undefined) ?? ""}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              className={controlClass(
                invalid,
                cn("pr-7 font-mono", matched && "border-success/60"),
              )}
            />
            {matched ? (
              <Check
                aria-hidden
                className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-success"
              />
            ) : null}
          </div>
        </div>
      )}
    </FormField>
  );
}
