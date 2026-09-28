import { KeyValue, KeyValueGrid } from "~/components/kv";
import { SectionHeader } from "~/components/ui/section-header";
import { cn } from "~/lib/utils";

/** An underlined link inside a detail, such as an id or ARN that opens its page. */
export const linkClass =
  "inline-flex items-center gap-1 break-all underline decoration-border underline-offset-2 hover:text-primary";

/** A resource's tags as a key-value grid, or nothing when it has none. */
export function TagsSection({
  tags,
  className,
}: {
  tags: Readonly<Record<string, string>>;
  className?: string;
}) {
  const entries = Object.entries(tags);
  if (entries.length === 0) return null;
  return (
    <section className={cn("flex flex-col gap-2 px-3.5 pb-3", className)}>
      <SectionHeader title="Tags" count={entries.length} />
      <KeyValueGrid>
        {entries.map(([key, value]) => (
          <KeyValue key={key} label={key}>
            {value}
          </KeyValue>
        ))}
      </KeyValueGrid>
    </section>
  );
}

/**
 * Says a listing stopped at its page cap, so only its first `count` items are
 * shown. `header` is the short form for a region-wide list's panel header;
 * `banner` is a strip across the top of a list.
 */
export function TruncatedNote({
  count,
  noun,
  place,
  className,
}: {
  count: number;
  /** What is listed, plural: "deployments". */
  noun: string;
  place: "header" | "banner";
  className?: string;
}) {
  if (place === "header") {
    return (
      <span
        className={cn("font-mono text-[10.5px] whitespace-nowrap text-warning", className)}
        title={`This region has more ${noun} than one listing covers.`}
      >
        first {count} only
      </span>
    );
  }
  return (
    <p
      className={cn(
        "border-b border-border px-3 py-1.5 font-mono text-[10.5px] text-warning",
        className,
      )}
    >
      first {count} {noun} only
    </p>
  );
}
