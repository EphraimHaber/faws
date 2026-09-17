import { AlertTriangle } from "lucide-react";

/**
 * Whatever went wrong with the submission itself, rather than with one field.
 *
 * A refused mutation, a permission denial, a partial failure: the message is
 * shown verbatim, because an AWS error names the thing to fix and a rewritten
 * one does not.
 */
export function FormError({ error }: { error: unknown }) {
  const message = formErrorMessage(error);
  if (!message) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-danger/35 bg-danger/8 px-2.5 py-2"
    >
      <AlertTriangle className="mt-px size-3.5 shrink-0 text-danger" strokeWidth={1.7} />
      <p className="font-mono text-[11.5px] leading-relaxed text-foreground">{message}</p>
    </div>
  );
}

function formErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}
