/**
 * Pushes every settings change to every open window.
 *
 * This is what makes "the same machine" feel like one app rather than two:
 * mute a service in the browser and the Electron window stops showing it,
 * without a reload and without either side polling.
 */
import { emitSettingsChanged } from "../../shared/socket-io.ts";
import { settingsStore } from "./settings.instance.ts";

/**
 * Must be called *after* `setupSocketIO`, for the same reason the log
 * broadcaster is wired inside it: an emit before the io instance exists is
 * silently dropped, and the change that gets dropped is the first one.
 */
export function attachSettingsBroadcast(): () => void {
  return settingsStore().subscribe((snapshot, originId) => {
    emitSettingsChanged({ ...snapshot, originId });
  });
}
