import * as monaco from "monaco-editor/editor/editor.api";
import * as React from "react";

import { useTheme } from "~/contexts/ThemeContext";
import { defineMonacoTheme, MONACO_THEME } from "~/lib/monaco";

/**
 * Read-only text on Monaco.
 *
 * Only JSON's language support is bundled, so everything else opens as plain
 * text: the alternative is shipping every Monaco language, which costs several
 * megabytes for syntax colour in a pane that exists to be read, not edited.
 */
export function TextViewer({ text, language = "plaintext" }: { text: string; language?: string }) {
  const { theme } = useTheme();
  const host = React.useRef<HTMLDivElement>(null);
  const editor = React.useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  React.useEffect(() => {
    if (!host.current) return;

    defineMonacoTheme();
    const instance = monaco.editor.create(host.current, {
      value: "",
      language,
      theme: MONACO_THEME,
      readOnly: true,
      domReadOnly: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
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
      automaticLayout: true,
    });

    editor.current = instance;
    return () => {
      instance.getModel()?.dispose();
      instance.dispose();
      editor.current = null;
    };
  }, [language]);

  // Setting the value rather than recreating the editor keeps the scroll
  // position and any folds when the same document is read again.
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
