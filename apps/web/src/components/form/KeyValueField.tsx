import { Plus, X } from "lucide-react";
import { useFieldArray, useFormContext, type FieldPath, type FieldValues } from "react-hook-form";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

/** The shape a `KeyValueField` expects at its path: an ordered pair list. */
export interface KeyValuePair {
  key: string;
  value: string;
}

/**
 * Repeatable key and value rows, for tags and user metadata.
 *
 * The value on the wire is an object, but the rows are edited as an array: an
 * object cannot hold two drafts of the same key, and renaming a key in place
 * would drop its value the moment the new name collided with an existing one.
 * `pairsToRecord` converts at the edge.
 */
export function KeyValueField<Values extends FieldValues, Name extends FieldPath<Values>>({
  name,
  label,
  hint,
  keyPlaceholder = "key",
  valuePlaceholder = "value",
  max,
  className,
}: {
  name: Name;
  label: string;
  hint?: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** Upper bound the surrounding schema also enforces. */
  max?: number;
  className?: string;
}) {
  const form = useFormContext<Values>();
  const { fields, append, remove } = useFieldArray<Values>({
    name: name as never,
  });
  const error = form.formState.errors[name as keyof typeof form.formState.errors];
  const message = typeof error?.message === "string" ? error.message : undefined;
  const atLimit = max !== undefined && fields.length >= max;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="font-mono text-[9.5px] tracking-[0.18em] text-muted-foreground uppercase">
        {label}
      </span>

      {fields.length === 0 ? (
        <p className="text-[11.5px] text-muted-foreground">None.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {fields.map((row, index) => (
            <li key={row.id} className="flex items-center gap-1.5">
              <Input
                {...form.register(`${name}.${index}.key` as never)}
                placeholder={keyPlaceholder}
                aria-label={`${label} ${index + 1} key`}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
              <Input
                {...form.register(`${name}.${index}.value` as never)}
                placeholder={valuePlaceholder}
                aria-label={`${label} ${index + 1} value`}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${label} ${index + 1}`}
                onClick={() => remove(index)}
              >
                <X className="size-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={atLimit}
          onClick={() => append({ key: "", value: "" } as never)}
        >
          <Plus className="size-3" /> Add
        </Button>
        {max === undefined ? null : (
          <span className="font-mono text-[10.5px] text-muted-foreground tabular">
            {fields.length} / {max}
          </span>
        )}
      </div>

      {message ? (
        <p role="alert" className="text-[11.5px] text-danger">
          {message}
        </p>
      ) : hint ? (
        <p className="text-[11.5px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Rows to the object the API takes; a blank key drops its row. */
export function pairsToRecord(pairs: ReadonlyArray<KeyValuePair>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const key = pair.key.trim();
    if (key.length > 0) out[key] = pair.value;
  }
  return out;
}

/** The object as rows, for seeding the editor with what is already set. */
export function recordToPairs(record: Readonly<Record<string, string>>): KeyValuePair[] {
  return Object.entries(record).map(([key, value]) => ({ key, value }));
}
