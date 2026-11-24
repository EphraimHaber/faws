import { Sparkles, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import * as React from "react";

import { textActionClass } from "~/components/ui/text-action";
import { CHANGELOG, changesBetween, compareVersions } from "~/lib/changelog";
import { updateSettings, useSettings } from "~/stores/settings";

/**
 * "Updated to 0.4.0" on the first launch of a newer version, with a way to
 * read what changed. Dismissing it, or opening the notes, records the version
 * as seen. A first launch ever only records it: there is nothing to compare.
 */
export function UpdatedBanner() {
  const ready = useSettings((state) => state.ready);
  const lastSeen = useSettings((state) => state.settings.updates.lastSeenVersion);
  const current = import.meta.env.APP_VERSION;

  const markSeen = React.useCallback(
    () => updateSettings({ updates: { lastSeenVersion: current } }),
    [current],
  );

  React.useEffect(() => {
    if (ready && lastSeen === "") markSeen();
  }, [ready, lastSeen, markSeen]);

  if (!ready || lastSeen === "" || compareVersions(current, lastSeen) <= 0) return null;
  const changes = changesBetween(CHANGELOG, lastSeen, current).reduce(
    (count, release) =>
      count + release.sections.reduce((sum, section) => sum + section.entries.length, 0),
    0,
  );

  return (
    <div
      role="status"
      className="mb-3 flex shrink-0 items-center gap-3 rounded-lg border border-primary/35 bg-primary/8 px-3.5 py-2 text-[12.5px]"
    >
      <Sparkles className="size-3.5 shrink-0 text-primary" strokeWidth={1.8} aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        Updated to faws {current}
        {changes > 0 ? ` with ${changes} change${changes === 1 ? "" : "s"}` : ""}.
      </span>
      <Link to="/whats-new" onClick={markSeen} className={textActionClass}>
        what's new
      </Link>
      <button
        type="button"
        onClick={markSeen}
        aria-label="Dismiss"
        className="grid size-6 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="size-3.5" strokeWidth={1.8} />
      </button>
    </div>
  );
}
