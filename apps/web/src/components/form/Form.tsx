import type * as React from "react";
import {
  FormProvider,
  type FieldValues,
  type SubmitHandler,
  type UseFormReturn,
} from "react-hook-form";

import { cn } from "~/lib/utils";

/**
 * The element every form in the app is wrapped in.
 *
 * It owns two things the fields below it depend on: the context the field
 * components read their state from, and the submit path, so no caller writes
 * `handleSubmit` by hand.
 */
export function Form<In extends FieldValues, Out extends FieldValues>({
  form,
  onSubmit,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"form">, "onSubmit"> & {
  form: UseFormReturn<In, unknown, Out>;
  onSubmit: SubmitHandler<Out>;
}) {
  return (
    <FormProvider {...form}>
      <form
        // `noValidate` hands validation to the schema alone; the browser's own
        // bubbles would report a different set of rules in a different voice.
        noValidate
        onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
        className={cn("flex flex-col gap-3", className)}
        {...props}
      >
        {children}
      </form>
    </FormProvider>
  );
}

/** Groups related fields under a heading inside a longer form. */
export function FormSection({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex flex-col gap-2.5", className)}>
      <h3 className="font-mono text-[9.5px] tracking-[0.18em] text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** The trailing row of a dialog form: secondary actions left, submit right. */
export function FormActions({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-center justify-end gap-2 pt-1", className)}>{children}</div>
  );
}
