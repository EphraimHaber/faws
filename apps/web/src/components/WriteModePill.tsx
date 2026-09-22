import { useHotkeys } from "@tanstack/react-hotkeys";
import { Lock, ShieldAlert, Unlock } from "lucide-react";
import * as React from "react";

import { Button } from "~/components/ui/button";
import { useWriteMode, type WriteLevel } from "~/hooks/useWriteMode";
import { useOverlay, useOverlaysOpen } from "~/stores/overlays";
import { cn } from "~/lib/utils";

/** How each level reads, in one place, so nothing describes it differently. */
const LEVELS: Record<WriteLevel, { label: string; hint: string; className: string }> = {
  read: {
    label: "read-only",
    hint: "Nothing in this session can change your infrastructure.",
    className: "border-success/30 bg-success/10 text-success",
  },
  write: {
    label: "read-write",
    hint: "This session can create and update. Deleting still needs arming.",
    className: "border-warning/30 bg-warning/10 text-warning",
  },
  destructive: {
    label: "deletion armed",
    hint: "This session can delete things that do not come back.",
    className: "border-danger/35 bg-danger/12 text-danger",
  },
};

/**
 * What this session is allowed to do, in the title bar.
 *
 * It sits with the profile and the region because it belongs to the same
 * question those answer - what am I about to change, and where - and because
 * it is the one piece of that answer the app used to keep to itself. The mode
 * was a badge at the top of the Settings page, which is exactly where someone
 * who does not already know about it will never look.
 *
 * Arming is deliberate and disarming is not. Turning writes on, or arming
 * deletion, asks; going back to read-only is one click, because the safe
 * direction should never be the slower one.
 */
export function WriteModePill() {
  const { level, readOnly, destructive, ready, setReadOnly, setDestructive } = useWriteMode();
  const [open, setOpen] = React.useState(false);
  const overlayOpen = useOverlaysOpen();
  const { isTop } = useOverlay("write-mode", open);

  useHotkeys(
    [
      {
        hotkey: "Escape",
        callback: () => setOpen(false),
        options: { enabled: isTop, conflictBehavior: "allow" },
      },
    ],
    { preventDefault: true },
  );

  const current = LEVELS[level];
  const Icon = level === "read" ? Lock : level === "destructive" ? ShieldAlert : Unlock;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        title={current.hint}
        aria-label={`Write mode: ${current.label}`}
        className={cn(
          "flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 font-mono text-[10.5px] tracking-tight uppercase transition-opacity hover:opacity-80",
          current.className,
          // Until the server has answered, the pill shows the safe default
          // rather than a guess; dimming says the answer is still coming.
          !ready && "opacity-50",
        )}
      >
        <Icon className="size-3" strokeWidth={2} />
        {current.label}
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close write mode"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
            disabled={overlayOpen && !isTop}
          />
          <div className="absolute top-8 right-0 z-50 w-80 rounded-lg border border-border bg-popover p-3 shadow-xl">
            <p className="text-[12.5px] leading-relaxed text-foreground">{current.hint}</p>

            <div className="mt-3 flex flex-col gap-2">
              {readOnly ? (
                <Confirm
                  phrase="allow writes"
                  explain="Creating and updating becomes possible everywhere in the app. Deleting stays blocked until it is armed separately."
                  action="Allow writes"
                  onConfirm={() => {
                    setReadOnly(false);
                    setOpen(false);
                  }}
                />
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setReadOnly(true);
                      setOpen(false);
                    }}
                  >
                    <Lock className="size-3" /> Return to read-only
                  </Button>

                  {destructive ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setDestructive(false);
                        setOpen(false);
                      }}
                    >
                      Disarm deletion
                    </Button>
                  ) : (
                    <Confirm
                      phrase="arm deletion"
                      explain="Deletes become possible. This is never remembered: it is off again the next time faws starts."
                      action="Arm deletion"
                      danger
                      onConfirm={() => {
                        setDestructive(true);
                        setOpen(false);
                      }}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * A switch that has to be typed out before it moves.
 *
 * The same shape the multi-object delete uses: the phrase is not a password,
 * it is a pause. Both directions of this pill are one click away from
 * something that matters, and only one of them is the safe direction.
 */
function Confirm({
  phrase,
  explain,
  action,
  danger = false,
  onConfirm,
}: {
  phrase: string;
  explain: string;
  action: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = React.useState("");
  const matches = typed.trim().toLowerCase() === phrase;

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border p-2">
      <p className="text-[11.5px] leading-snug text-muted-foreground">{explain}</p>
      <label className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
        type “{phrase}”
      </label>
      <input
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && matches) onConfirm();
        }}
        aria-label={`Type ${phrase} to confirm`}
        className="h-7 rounded border border-border bg-background/60 px-2 font-mono text-[12px] focus:border-primary/50 focus:outline-none"
      />
      <Button
        size="sm"
        variant={danger ? "danger" : "default"}
        disabled={!matches}
        onClick={onConfirm}
      >
        {action}
      </Button>
    </div>
  );
}
