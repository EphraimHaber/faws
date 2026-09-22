import * as monaco from "monaco-editor/editor/editor.api";
import * as React from "react";

import { useTheme } from "~/contexts/ThemeContext";
import { defineMonacoTheme, MONACO_THEME } from "~/lib/monaco";

/**
 * Read-only JSON pane on Monaco.
 *
 * A task definition is a deep document, and what people actually do with one —
 * fold the container array, find an env var, copy a block — are editor
 * gestures. Search, folding and bracket matching come for free, which is the
 * whole reason this isn't a `<pre>`.
 *
 * Monaco is mounted directly rather than through `@monaco-editor/react`: that
 * wrapper exists to fetch Monaco from a CDN, which a packaged desktop app with
 * no network can't do.
 */
export function JsonViewer({ value }: { value: unknown }) {
  const { theme } = useTheme();
  const host = React.useRef<HTMLDivElement>(null);
  const editor = React.useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const text = React.useMemo(() => JSON.stringify(value, null, 2), [value]);

  React.useEffect(() => {
    if (!host.current) return;

    defineMonacoTheme();
    const instance = monaco.editor.create(host.current, {
      value: "",
      language: "json",
      theme: MONACO_THEME,
      readOnly: true,
      domReadOnly: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      // Never clip: long image URIs and command arrays wrap rather than hide
      // behind a horizontal scrollbar.
      wordWrap: "on",
      wrappingIndent: "deepIndent",
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      lineHeight: 20,
      lineNumbersMinChars: 3,
      folding: true,
      renderLineHighlight: "none",
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9, useShadows: false },
      padding: { top: 12, bottom: 12 },
      contextmenu: false,
      // Monaco can't infer its size from a flex parent; this re-layouts on
      // container resize without us wiring a ResizeObserver.
      automaticLayout: true,
    });

    editor.current = instance;
    return () => {
      instance.getModel()?.dispose();
      instance.dispose();
      editor.current = null;
    };
  }, []);

  // Setting the value rather than recreating the editor keeps the scroll
  // position and any folds when the same document refetches.
  React.useEffect(() => {
    const instance = editor.current;
    if (!instance || instance.getValue() === text) return;
    instance.setValue(text);
  }, [text]);

  React.useEffect(() => {
    // `theme` is the trigger rather than an input: defineMonacoTheme reads the
    // live computed palette, which is only correct once ThemeProvider has
    // flipped the class on the document.
    defineMonacoTheme();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [theme]);

  return <div ref={host} className="size-full" />;
}
