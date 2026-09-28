import * as React from "react";

import { JsonViewer } from "~/components/JsonViewer";

/** JSON text in the JSON viewer, or as plain text when it does not parse. */
export function JsonText({ text }: { text: string }) {
  // Parsed outside the render, so a document that does not parse falls back to
  // its own text rather than throwing where nothing is left to catch it.
  const parsed = React.useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(text) as unknown };
    } catch {
      return { ok: false as const };
    }
  }, [text]);

  if (!parsed.ok) {
    return <pre className="overflow-auto p-3 font-mono text-[11.5px]">{text}</pre>;
  }
  return <JsonViewer value={parsed.value} />;
}
