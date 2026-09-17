import { useFormState } from "react-hook-form";

import { Button, type ButtonProps } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";

/**
 * The submit control, disabled while a submission is in flight.
 *
 * It reads the form's own state rather than taking a pending prop, so a caller
 * cannot forget to pass it and leave a button that can be pressed twice.
 */
export function SubmitButton({
  children,
  disabled,
  pending,
  ...props
}: Omit<ButtonProps, "type"> & {
  /** Set when the work continues past the submit handler resolving. */
  pending?: boolean;
}) {
  const { isSubmitting } = useFormState();
  const busy = isSubmitting || Boolean(pending);

  return (
    <Button type="submit" disabled={busy || disabled} aria-busy={busy} {...props}>
      {busy ? <Spinner className="size-3" /> : null}
      {children}
    </Button>
  );
}
