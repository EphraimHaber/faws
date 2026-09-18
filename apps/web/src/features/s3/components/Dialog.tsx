import { useHotkeys } from "@tanstack/react-hotkeys";
import type * as React from "react";

import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { useOverlay } from "~/stores/overlays";

/**
 * The modal frame the S3 forms sit in.
 *
 * Escape is registered with `ignoreInputs: false`, because the cursor is
 * inside a field for the whole life of one of these: a cancel key that stops
 * working once you start typing is a cancel key that does not work.
 */
export function Dialog({
  id,
  title,
  onClose,
  children,
}: {
  id: string;
  title: string;
  onClose: () => void;
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 p-8 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <Panel
        role="dialog"
        aria-modal
        aria-label={title}
        className="w-full max-w-xl shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <PanelHeader>
          <PanelTitle>{title}</PanelTitle>
        </PanelHeader>
        <div className="p-3.5">{children}</div>
      </Panel>
    </div>
  );
}
