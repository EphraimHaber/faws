import { cn } from "~/lib/utils";

/** The faws radar glyph, drawn in `currentColor` so it follows the theme. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      aria-hidden
      fill="currentColor"
      stroke="currentColor"
      className={cn("size-4 shrink-0", className)}
    >
      <path d="M512 512 L512 132 A380 380 0 0 1 780.7 243.3 Z" stroke="none" fillOpacity={0.55} />
      <circle cx="512" cy="512" r="380" fill="none" strokeWidth={72} />
      <line x1="512" y1="512" x2="780.7" y2="243.3" strokeWidth={80} strokeLinecap="round" />
      <circle cx="512" cy="512" r="90" stroke="none" />
      <circle cx="672" cy="704" r="96" stroke="none" />
    </svg>
  );
}

/** Glyph plus wordmark, sized for the sidebar header. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 select-none", className)}>
      <LogoMark className="size-5 text-primary" />
      <span className="text-[15px] font-semibold tracking-tight text-foreground">faws</span>
    </span>
  );
}
