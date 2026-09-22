import { Link, useRouterState } from "@tanstack/react-router";
import { Command, MoonStar, Sun } from "lucide-react";

import { AccountChip } from "~/components/AccountChip";
import { Breadcrumb } from "~/components/Breadcrumb";
import { RegionPicker } from "~/components/RegionPicker";
import { WriteModePill } from "~/components/WriteModePill";
import { Kbd } from "~/components/ui/kbd";
import { useTheme } from "~/contexts/ThemeContext";
import { serviceForPath } from "~/services/registry";

/**
 * Title bar: identity on the left, AWS context on the right.
 *
 * e1s answers "which account am I about to change?" in a footer line. Putting
 * account, profile and region in the title bar — always, in one place — is the
 * single biggest safety win a GUI gets over the TUI.
 */
export function AppHeader({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { theme, toggle } = useTheme();
  const { location } = useRouterState();
  // Which section is open, so the wordmark on an S3 page does not say "ecs".
  const service = serviceForPath(location.pathname);

  return (
    <header className="drag-region titlebar-inset z-30 flex h-12 shrink-0 items-center gap-3 border-b border-border bg-chrome px-4 whitespace-nowrap lg:gap-5">
      <Link to="/" className="flex shrink-0 items-center gap-2.5">
        <BrandMark />
        <span className="flex items-baseline gap-1.5 leading-none">
          <span className="text-[15px] font-semibold tracking-tight text-foreground">faws</span>
          <span className="font-mono text-[9px] tracking-[0.3em] text-muted-foreground uppercase">
            {service?.id ?? "aws"}
          </span>
        </span>
      </Link>

      <span aria-hidden className="h-3.5 w-px shrink-0 bg-border" />

      {/* The breadcrumb takes whatever the controls leave and truncates; the
          controls never shrink, because a wrapped region or write mode is
          harder to read than a shortened trail. */}
      <div className="min-w-0 flex-1 overflow-hidden">
        <Breadcrumb />
      </div>

      <div className="flex shrink-0 items-center gap-2 lg:gap-3">
        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="Jump to…"
          className="flex h-7 items-center gap-2 rounded-md border border-border bg-background/60 pl-2 pr-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Command className="size-3" strokeWidth={1.9} />
          <span className="hidden lg:inline">Jump to…</span>
          <Kbd>⌘K</Kbd>
        </button>
        <span aria-hidden className="h-3.5 w-px bg-border" />
        <AccountChip />
        <span aria-hidden className="h-3.5 w-px bg-border" />
        <RegionPicker />
        <span aria-hidden className="h-3.5 w-px bg-border" />
        <WriteModePill />
        <button
          type="button"
          onClick={toggle}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          className="grid size-7 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {theme === "dark" ? (
            <MoonStar className="size-3.5" strokeWidth={1.8} />
          ) : (
            <Sun className="size-3.5" strokeWidth={1.8} />
          )}
        </button>
      </div>
    </header>
  );
}

/* Three stacked bars of decreasing length with a live dot: a container
   manifest, not a generic cloud. */
function BrandMark() {
  return (
    <span className="grid size-6 place-items-center rounded-[6px] border border-primary/35 bg-primary/10 text-primary">
      <svg
        viewBox="0 0 16 16"
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      >
        <path d="M3 4.5h10" />
        <path d="M3 8h7" />
        <path d="M3 11.5h4" />
        <circle cx="12" cy="11.5" r="1.4" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}
