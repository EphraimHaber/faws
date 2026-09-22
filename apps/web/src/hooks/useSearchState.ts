import { useNavigate, useSearch } from "@tanstack/react-router";
import * as React from "react";

/**
 * A piece of page state that lives in the URL rather than in the component.
 *
 * `useTabSearch` already did this for one thing - which tab is open - and the
 * argument generalises: a filter someone typed, a set of rows they ticked and a
 * search they ran are all part of "where am I?" on that page. Kept in component
 * state they survive nothing. A reload clears them, the back button cannot
 * reach them, and a link pasted to a colleague opens on a different view than
 * the one being described.
 *
 * Two conventions hold everywhere this is used:
 *
 * - **The fallback is the absent param.** A value equal to `fallback`
 *   serialises to nothing at all, which keeps the plain URL clean and means
 *   there is exactly one URL for the default view rather than one per
 *   defaulted field.
 * - **Writes replace the history entry.** Typing is not a trail: without this,
 *   the back button walks a filter box backwards one keystroke at a time
 *   instead of leaving the page.
 *
 * Validation stays on the route. Every `validateSearch` in the router `catch`es
 * at each leaf, so a hand-edited or stale URL is already sanitised by the time
 * `parse` sees it; `parse` narrows, it does not defend.
 */
export interface SearchStateOptions<T> {
  /** The search param's name. */
  readonly key: string;
  /** The value that means "this param is absent". */
  readonly fallback: T;
  /** Narrows whatever the route handed over into `T`. */
  parse(raw: unknown): T;
  /** Returns undefined to remove the param; defaults to `String`. */
  serialize?(value: T): string | undefined;
  /**
   * Holds the URL still for this long after a change.
   *
   * For a box someone types into. Without it every keystroke is a router pass
   * and a history write; with it the input stays responsive because the value
   * shown is local until it settles.
   */
  readonly debounceMs?: number;
}

export function useSearchState<T>(options: SearchStateOptions<T>): readonly [T, (next: T) => void] {
  const { key, fallback, parse, serialize, debounceMs = 0 } = options;
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as Record<string, unknown>;

  const raw = search[key];
  const fromUrl = parse(raw);

  // What the input shows while a debounce is in flight, tagged with the URL it
  // was typed against. Comparing that tag on read - rather than clearing it
  // from an effect - is what makes the URL the source of truth at rest: the
  // moment the param changes, by our own commit or by a link or the back
  // button, the held value stops applying without a second render to undo it.
  const [pending, setPending] = React.useState<{ value: T; raw: unknown } | null>(null);
  const held = pending !== null && Object.is(pending.raw, raw) ? pending.value : fromUrl;

  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  const commit = React.useCallback(
    (value: T) => {
      const encoded = serialize ? serialize(value) : defaultSerialize(value, fallback);
      void navigate({
        to: ".",
        search: ((prev: Record<string, unknown>) => {
          const { [key]: _current, ...rest } = prev;
          return encoded === undefined ? rest : { ...rest, [key]: encoded };
        }) as never,
        replace: true,
      });
    },
    [navigate, key, fallback, serialize],
  );

  const set = React.useCallback(
    (next: T) => {
      if (debounceMs <= 0) {
        commit(next);
        return;
      }
      setPending({ value: next, raw });
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        commit(next);
      }, debounceMs);
    },
    [commit, debounceMs, raw],
  );

  return [held, set] as const;
}

function defaultSerialize<T>(value: T, fallback: T): string | undefined {
  if (value === fallback) return undefined;
  const text = String(value);
  return text.length === 0 ? undefined : text;
}

/** How long a filter box holds still before it touches the URL. */
const FILTER_DEBOUNCE_MS = 200;

/**
 * The text in a filter box, in the URL.
 *
 * `q` by default, because a page has one obvious filter and a name that reads
 * in a pasted link is worth more than a descriptive one.
 */
export function useFilterSearch(key = "q"): readonly [string, (next: string) => void] {
  return useSearchState<string>({
    key,
    fallback: "",
    parse: parseText,
    debounceMs: FILTER_DEBOUNCE_MS,
  });
}

export function parseText(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

/**
 * Which rows are ticked, in the URL.
 *
 * Comma-separated, which is readable in a link and safe here because the ids
 * this carries - ARNs, instance ids, object keys - are percent-encoded by the
 * router on the way out.
 */
export function useSelectionSearch(
  key = "sel",
): readonly [ReadonlySet<string>, (next: ReadonlySet<string>) => void] {
  const [raw, setRaw] = useSearchState<string>({ key, fallback: "", parse: parseText });

  const selected = React.useMemo(() => parseSelection(raw), [raw]);
  const set = React.useCallback(
    (next: ReadonlySet<string>) => setRaw(serializeSelection(next) ?? ""),
    [setRaw],
  );

  return [selected, set] as const;
}

export function parseSelection(raw: unknown): Set<string> {
  if (typeof raw !== "string" || raw.length === 0) return new Set();
  return new Set(raw.split(",").filter((entry) => entry.length > 0));
}

export function serializeSelection(selected: ReadonlySet<string>): string | undefined {
  if (selected.size === 0) return undefined;
  // Sorted so the same selection is always the same URL, however it was built.
  return [...selected].toSorted().join(",");
}
