import { useController, type FieldPath, type FieldValues } from "react-hook-form";

import { Segmented } from "~/components/segmented";
import { FormField } from "~/components/form/FormField";

export interface RadioOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly count?: number;
}

/**
 * An exclusive choice, rendered as the same segmented strip the detail panes
 * use, so a choice inside a form looks like a choice everywhere else.
 *
 * The radio semantics come from the group role and the arrow key handling in
 * the strip itself rather than from native inputs.
 */
export function RadioGroupField<
  Values extends FieldValues,
  Name extends FieldPath<Values>,
  Option extends string,
>({
  name,
  label,
  hint,
  options,
  className,
}: {
  name: Name;
  label: string;
  hint?: string;
  options: ReadonlyArray<RadioOption<Option>>;
  className?: string;
}) {
  const { field } = useController<Values, Name>({ name });

  return (
    <FormField<Values, Name> name={name} label={label} {...(hint ? { hint } : {})}>
      {() => (
        <Segmented
          options={options.map((option) => ({
            value: option.value,
            label: option.label,
            ...(option.count === undefined ? {} : { count: option.count }),
          }))}
          value={(field.value as Option | undefined) ?? options[0]?.value ?? ("" as Option)}
          onChange={(next) => field.onChange(next)}
          {...(className ? { className } : {})}
        />
      )}
    </FormField>
  );
}
