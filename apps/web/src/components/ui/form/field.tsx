import * as React from "react";

import { cn } from "~/lib/utils";

/**
 * One labelled row in a form.
 *
 * The label sits beside its control rather than above it, which is what keeps
 * a dialog of six settings readable at this density - the same shape the
 * service update dialog established.
 *
 * `error` renders under the label rather than under the control, so a long
 * message does not push the control off its row or reflow the dialog as the
 * user types.
 */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  htmlFor?: string | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="min-w-0 flex-1">
        <label htmlFor={htmlFor} className="text-[12.5px]">
          {label}
        </label>
        {hint ? <p className="font-mono text-[10.5px] text-muted-foreground">{hint}</p> : null}
        {error ? <p className="text-[11px] text-danger">{error}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** The form-level error line, for a failure that belongs to no single field. */
export function FormError({ message }: { message?: string | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-sm bg-danger/10 px-2 py-1.5 text-[11.5px] text-danger">
      {message}
    </p>
  );
}
