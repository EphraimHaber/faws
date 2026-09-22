import type * as React from "react";

import { cn } from "~/lib/utils";

/**
 * A secondary action written as a quiet underlined word: "restore all",
 * "manage", "see the individual tasks".
 *
 * Text rather than a `Button`, because these sit in a header or at the end of
 * a sentence beside the thing they act on, and a bordered control there would
 * compete with the panel's own primary action.
 *
 * The classes are exported for the one caller that has to be a router `Link`.
 */
export const textActionClass =
  "cursor-pointer font-mono text-[10.5px] text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground disabled:cursor-default disabled:no-underline disabled:opacity-40";

export function TextAction({ className, ...props }: React.ComponentProps<"button">) {
  return <button type="button" className={cn(textActionClass, className)} {...props} />;
}
