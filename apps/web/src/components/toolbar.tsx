import { SearchField } from "~/components/SearchField";

/**
 * The filter bar that sits above every table. `/` focuses it and Escape
 * clears it — the TUI contract — but it stays visible instead of appearing
 * as a modal line, so you can always see whether a filter is active.
 *
 * It filters the rows this page has already loaded and nothing else, which is
 * why it is a `SearchField` on the `loaded` surface: the S3 object browser
 * puts one of these directly above a box that walks the whole bucket, and the
 * two used to be indistinguishable.
 */
export function FilterInput({
  value,
  onChange,
  placeholder = "Filter… (try service:api)",
  count,
  total,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  count?: number;
  total?: number;
}) {
  return (
    <SearchField
      surface="loaded"
      hotkey
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      count={count}
      total={total}
    />
  );
}
