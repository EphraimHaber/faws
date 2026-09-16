import { Check, Copy, X } from "lucide-react";

import { Button, type ButtonProps } from "~/components/ui/button";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";

/**
 * Copies `value`, which may be a thunk so callers don't serialize a large
 * document on every render just in case someone clicks.
 */
export function CopyButton({
  value,
  label,
  className,
  ...props
}: Omit<ButtonProps, "onClick" | "value"> & {
  value: string | (() => string);
  /**
   * Names the thing being copied. Always used for the tooltip and the
   * accessible name; only rendered as visible text when the button has room
   * for it, since `size="icon"` is a fixed square.
   */
  label?: string;
}) {
  const { copied, failed, copy } = useCopyToClipboard();
  const showLabel = Boolean(label) && props.size !== "icon";

  return (
    <Button
      type="button"
      onClick={() => void copy(typeof value === "function" ? value() : value)}
      title={copied ? "Copied" : failed ? "Copy failed" : `Copy ${label ?? "to clipboard"}`}
      aria-label={`Copy ${label ?? "to clipboard"}`}
      className={cn(copied && "text-success", failed && "text-danger", className)}
      {...props}
    >
      {copied ? (
        <Check className="size-3" strokeWidth={2.2} />
      ) : failed ? (
        <X className="size-3" strokeWidth={2.2} />
      ) : (
        <Copy className="size-3" strokeWidth={1.9} />
      )}
      {showLabel ? <span>{copied ? "Copied" : label}</span> : null}
    </Button>
  );
}

/** Inline variant for sitting beside a value in a detail pane. */
export function CopyIcon({ value, label }: { value: string; label?: string }) {
  const { copied, failed, copy } = useCopyToClipboard();

  return (
    <button
      type="button"
      onClick={() => void copy(value)}
      aria-label={`Copy ${label ?? value}`}
      title={copied ? "Copied" : failed ? "Copy failed" : "Copy"}
      className={cn(
        "grid size-4 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground/50 transition-colors hover:text-foreground",
        copied && "text-success",
        failed && "text-danger",
      )}
    >
      {copied ? <Check className="size-2.5" strokeWidth={2.4} /> : <Copy className="size-2.5" />}
    </button>
  );
}
