import { useHotkeys } from "@tanstack/react-hotkeys";
import {
  formatForDisplay,
  getHotkeyManager,
  toHotkeyRegistrationView,
} from "@tanstack/react-hotkeys";
import * as React from "react";

import { Kbd } from "~/components/ui/kbd";
import { HOTKEY_CATEGORIES, type HotkeyCategory } from "~/lib/hotkeys";
import { useOverlay } from "~/stores/overlays";

interface Entry {
  readonly id: string;
  readonly keys: string;
  readonly action: string;
}

/**
 * The `?` / F1 overlay.
 *
 * Rendered from the live hotkey registry rather than a hand-kept list, so a
 * binding cannot drift from its documentation: if a key isn't registered it
 * doesn't appear here, and if it moves, this moves with it.
 */
export function KeyboardHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <HelpBody onClose={onClose} />;
}

function HelpBody({ onClose }: { onClose: () => void }) {
  const { isTop } = useOverlay("keyboard-help", true);

  useHotkeys(
    [
      {
        hotkey: "Escape",
        callback: onClose,
        options: { enabled: isTop, conflictBehavior: "allow" },
      },
    ],
    { preventDefault: true },
  );

  // Snapshot rather than subscribe: the registry is a store that every
  // component writes to as it renders, and a live subscription here would
  // mean this component updates during those renders. The registry can't
  // change while the overlay has focus anyway.
  const [hotkeys] = React.useState(() =>
    [...getHotkeyManager().registrations.state.values()].map(toHotkeyRegistrationView),
  );

  const groups = React.useMemo(() => {
    const byCategory = new Map<HotkeyCategory, Map<string, Entry>>();

    for (const registration of hotkeys) {
      const { category, name } = registration.options.meta ?? {};
      if (!category || !name) continue;

      const keys = formatForDisplay(registration.parsedHotkey);
      const group = byCategory.get(category) ?? new Map<string, Entry>();
      // Several keys often drive one action (j and ArrowDown, ? and F1).
      // They collapse into a single row listing both.
      const existing = group.get(name);
      group.set(name, {
        id: name,
        action: name,
        keys: existing ? `${existing.keys}  ${keys}` : keys,
      });
      byCategory.set(category, group);
    }

    return HOTKEY_CATEGORIES.map((category) => ({
      title: category,
      entries: [...(byCategory.get(category)?.values() ?? [])],
    })).filter((group) => group.entries.length > 0);
  }, [hotkeys]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[2px]">
      <button
        type="button"
        aria-label="Close help"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative w-[min(820px,92vw)] rounded-xl border border-border bg-popover p-6 shadow-2xl">
        <div className="mb-5 flex items-baseline gap-3">
          <h2 className="text-[15px] font-semibold">Keyboard</h2>
          <p className="text-[12px] text-muted-foreground">
            Everything here works without the mouse.
          </p>
          <Kbd className="ml-auto">esc</Kbd>
        </div>

        <div className="grid grid-cols-1 gap-7 sm:grid-cols-3">
          {groups.map((group) => (
            <div key={group.title}>
              <p className="mb-2.5 font-mono text-[9.5px] tracking-[0.24em] text-muted-foreground uppercase">
                {group.title}
              </p>
              <ul className="flex flex-col gap-1.5">
                {group.entries.map((entry) => (
                  <li key={entry.id} className="flex items-baseline gap-2.5 text-[12.5px]">
                    <Kbd className="shrink-0">{entry.keys}</Kbd>
                    <span className="text-muted-foreground">{entry.action}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {groups.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-muted-foreground">
            No hotkeys registered on this screen.
          </p>
        ) : null}
      </div>
    </div>
  );
}
