import * as React from "react";

/**
 * Copy with a short-lived "copied" flag for the button to render.
 *
 * `navigator.clipboard` is missing on insecure origins and can reject when the
 * window isn't focused, so there is a `document.execCommand` fallback — the
 * packaged app is served over http://127.0.0.1, where the modern API is
 * available, but `pnpm dev:web` over a LAN address is not a secure context.
 */
export function useCopyToClipboard(resetAfterMs = 1400): {
  copied: boolean;
  failed: boolean;
  copy(text: string): Promise<boolean>;
} {
  const [state, setState] = React.useState<"idle" | "copied" | "failed">("idle");
  const timer = React.useRef<number | undefined>(undefined);

  React.useEffect(() => {
    return () => window.clearTimeout(timer.current);
  }, []);

  const copy = React.useCallback(
    async (text: string) => {
      const ok = await writeToClipboard(text);
      setState(ok ? "copied" : "failed");
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState("idle"), resetAfterMs);
      return ok;
    },
    [resetAfterMs],
  );

  return { copied: state === "copied", failed: state === "failed", copy };
}

export async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path rather than failing outright.
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
