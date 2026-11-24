import * as React from "react";

import { desktopBridge } from "~/lib/desktop";
import { useSettings } from "~/stores/settings";

/**
 * Tells the desktop main process the update preferences whenever they change,
 * since it schedules the checks and the settings live in the window's store.
 */
export function useUpdatesConfig(): void {
  const autoCheck = useSettings((state) => state.settings.updates.autoCheck);
  const channel = useSettings((state) => state.settings.updates.channel);
  const feedUrl = useSettings((state) => state.settings.updates.feedUrl);
  const ready = useSettings((state) => state.ready);

  React.useEffect(() => {
    // Before settings load, the defaults would schedule a check someone may
    // have switched off.
    if (!ready) return;
    desktopBridge()?.updates?.configure({ autoCheck, channel, feedUrl });
  }, [autoCheck, channel, feedUrl, ready]);
}
