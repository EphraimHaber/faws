import { useHotkeys } from "@tanstack/react-hotkeys";
import type * as React from "react";

import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { useOverlay } from "~/stores/overlays";
import { cn } from "~/lib/utils";

/**
 * What every modal in the app owes its user: an entry on the overlay stack so
 * the page's shortcuts stand down, an Escape that closes it, and a backdrop
 * that does the same.
 *
 * Escape is registered with `ignoreInputs: false`, because the cursor is
 * inside a field for the whole life of one of these: a cancel key that stops
 * working once you start typing is a cancel key that does not work.
 *
 * The chrome is deliberately the caller's. The dialogs here differ in width,
 * in where they sit on the screen and in how heavy their backdrop is, and they
 * differ on purpose - a form read top to bottom is not placed like a picker
 * you open, glance at and dismiss. So the frame owns only the behaviour, and
 * `backdropClassName` and `className` carry the rest.
 */
export function DialogFrame({
  id,
  label,
  onClose,
  backdropClassName,
  className,
  children,
}: {
  id: string;
  /** Names the dialog to a screen reader; usually the same text as its title. */
  label: string;
  onClose: () => void;
  backdropClassName?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { isTop } = useOverlay(id, true);

  useHotkeys(
    [
      {
        hotkey: "Escape",
        callback: onClose,
        options: { enabled: isTop, ignoreInputs: false, conflictBehavior: "allow" },
      },
    ],
    { preventDefault: true },
  );

  return (
    <div
      className={cn("fixed inset-0 z-50 flex justify-center", backdropClassName)}
      // Only a click that landed on the backdrop itself closes: anything
      // inside reports its own element as the target, which is what keeps a
      // drag that ends outside a field from dismissing the form.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal aria-label={label} className={className}>
        {children}
      </div>
    </div>
  );
}

/** The house dialog: a titled `Panel` on the shared frame. */
export function Dialog({
  id,
  title,
  onClose,
  className,
  children,
}: {
  id: string;
  title: string;
  onClose: () => void;
  /** Overrides the width, for a form that does not fit the default column. */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <DialogFrame
      id={id}
      label={title}
      onClose={onClose}
      backdropClassName="items-start bg-background/70 p-8 backdrop-blur-sm"
      className={cn("w-full max-w-xl", className)}
    >
      <Panel className="shadow-lg">
        <PanelHeader>
          <PanelTitle>{title}</PanelTitle>
        </PanelHeader>
        <div className="p-3.5">{children}</div>
      </Panel>
    </DialogFrame>
  );
}
