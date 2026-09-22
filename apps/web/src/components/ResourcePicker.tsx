import { Search } from "lucide-react";
import * as React from "react";

import { rankBy } from "~/lib/rank";
import { cn } from "~/lib/utils";

/**
 * A list of things, narrowed by typing.
 *
 * The filter is `rankBy` rather than a `includes` test, which is the one
 * behaviour here that is not simply lifted from the caller it replaced. A
 * substring filter is a fine filter and a poor sort: with nothing typed the
 * order is the caller's, and the moment something is typed the thing whose
 * name starts with it should be first rather than wherever the account
 * happened to return it. `lib/rank` already decided that for the palette.
 *
 * Rows come in as children rather than as a shape this knows how to draw. What
 * a row *offers* is the whole difference between one of these lists and the
 * next - an instance offers a shell, an endpoint offers to be used - and a
 * picker that tried to own that would be a picker with a slot for every verb
 * in the app.
 *
 * No keyboard navigation, deliberately: every caller so far sits inside a
 * dialog that already owns Escape and the overlay stack, and a list that
 * claimed j/k there would be a second thing fighting for the same keys.
 */
export function ResourcePicker<T>({
  items,
  pending = false,
  keyOf,
  text,
  placeholder,
  pendingLabel,
  emptyLabel,
  className,
  children,
}: {
  items: ReadonlyArray<T>;
  pending?: boolean;
  keyOf: (item: T) => string;
  /** Everything worth matching against: a name, an id, an address. */
  text: (item: T) => ReadonlyArray<string>;
  placeholder: string;
  /** What to say while the list is still being fetched. */
  pendingLabel: string;
  emptyLabel: string;
  /** Carries the list's height, which is the caller's to decide. */
  className?: string;
  children: (item: T) => React.ReactNode;
}) {
  const [filter, setFilter] = React.useState("");
  const rows = React.useMemo(() => rankBy(items, filter, text), [items, filter, text]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <Search className="size-3 text-muted-foreground" />
        <input
          autoFocus
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div className={cn("overflow-auto", className)}>
        {pending ? (
          <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">{pendingLabel}</p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">{emptyLabel}</p>
        ) : (
          rows.map((row) => <React.Fragment key={keyOf(row)}>{children(row)}</React.Fragment>)
        )}
      </div>
    </div>
  );
}
