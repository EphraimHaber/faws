import { prefixTrail } from "@faws/shared";
import { ChevronRight, Database } from "lucide-react";

import { cn } from "~/lib/utils";

/** Beyond this the middle is elided; a deep key is otherwise the whole row. */
const MAX_SEGMENTS = 4;

/**
 * Where in the bucket the listing is, as a path you can climb.
 *
 * Long prefixes lose their middle rather than their ends: the bucket and the
 * folder being read are what locate you, and the segments between them are the
 * ones you already walked through.
 */
export function PrefixTrail({
  bucket,
  prefix,
  onNavigate,
}: {
  bucket: string;
  prefix: string;
  onNavigate: (prefix: string) => void;
}) {
  const segments = prefixTrail(prefix);
  const elided = segments.length > MAX_SEGMENTS;
  const shown = elided ? segments.slice(segments.length - MAX_SEGMENTS) : segments;

  return (
    <nav aria-label="Prefix" className="flex min-w-0 items-center gap-1 overflow-hidden">
      <Crumb icon label={bucket} onClick={() => onNavigate("")} active={prefix.length === 0} />
      {elided ? (
        <>
          <Separator />
          <span
            className="font-mono text-[11.5px] text-muted-foreground"
            title={segments
              .slice(0, segments.length - MAX_SEGMENTS)
              .map((segment) => segment.name)
              .join("/")}
          >
            …
          </span>
        </>
      ) : null}
      {shown.map((segment, index) => (
        <span key={segment.prefix} className="flex min-w-0 items-center gap-1">
          <Separator />
          <Crumb
            label={segment.name}
            onClick={() => onNavigate(segment.prefix)}
            active={index === shown.length - 1}
          />
        </span>
      ))}
    </nav>
  );
}

function Separator() {
  return <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground/45" />;
}

function Crumb({
  label,
  onClick,
  active,
  icon = false,
}: {
  label: string;
  onClick: () => void;
  active: boolean;
  icon?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...(active ? { "aria-current": "page" as const } : {})}
      className={cn(
        "flex min-w-0 cursor-pointer items-center gap-1.5 rounded px-1 font-mono text-[11.5px] transition-colors hover:text-foreground",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {icon ? <Database className="size-3 shrink-0" strokeWidth={1.7} /> : null}
      <span className="truncate">{label}</span>
    </button>
  );
}
