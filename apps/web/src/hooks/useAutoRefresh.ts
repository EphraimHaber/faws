import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { useScope } from "~/contexts/ScopeContext";

/**
 * Re-runs every mounted query on the scope's refresh interval and exposes the
 * seconds remaining, which the status bar renders as a countdown so the tick
 * is never a surprise. `refreshSeconds === -1` disables it.
 */
export function useAutoRefresh(): { secondsLeft: number; refreshNow(): void } {
  const { refreshSeconds } = useScope();
  const queryClient = useQueryClient();
  const [secondsLeft, setSecondsLeft] = React.useState(refreshSeconds);

  const refreshNow = React.useCallback(() => {
    void queryClient.invalidateQueries();
    setSecondsLeft(refreshSeconds);
  }, [queryClient, refreshSeconds]);

  React.useEffect(() => {
    if (refreshSeconds <= 0) {
      setSecondsLeft(-1);
      return;
    }
    setSecondsLeft(refreshSeconds);
    const id = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          void queryClient.invalidateQueries();
          return refreshSeconds;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [refreshSeconds, queryClient]);

  return { secondsLeft, refreshNow };
}
