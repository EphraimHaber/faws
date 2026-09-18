import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useForm, type FieldValues, type UseFormProps, type UseFormReturn } from "react-hook-form";
import type { z } from "zod";

/**
 * A form and the values it carries.
 *
 * The two type arguments are what keep a coercing or transforming schema
 * honest: the fields hold the input type while the submit handler receives the
 * parsed output type.
 */
export type ZodForm<In extends FieldValues, Out extends FieldValues> = UseFormReturn<
  In,
  unknown,
  Out
>;

/**
 * A form bound to a schema from `@faws/contracts`.
 *
 * The schema a form validates with is the same object the API validates with,
 * so a rule cannot be enforced on one side and forgotten on the other.
 */
export function useZodForm<In extends FieldValues, Out extends FieldValues>(
  schema: z.ZodType<Out, In>,
  options?: Omit<UseFormProps<In, unknown, Out>, "resolver">,
): ZodForm<In, Out> {
  return useForm<In, unknown, Out>({
    // Validating on blur rather than per keystroke keeps a half typed name
    // from turning red before it can possibly be complete; once a field has
    // been marked invalid it re validates as you fix it.
    mode: "onBlur",
    reValidateMode: "onChange",
    ...options,
    // `standardSchemaResolver` rather than `zodResolver`: zod v4 implements the
    // standard schema interface, and this entry point carries no zod v3
    // compatibility layer.
    resolver: standardSchemaResolver(schema),
  });
}
