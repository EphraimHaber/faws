import { Check, ChevronDown, ChevronRight, Copy, X } from "lucide-react";
import * as React from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { type AnsiSpan, parseAnsi, stripAnsi } from "~/lib/ansi";
import { type JsonToken, jsonLineText, parseJsonLine, TOKEN_CLASS, tokenize } from "~/lib/json-log";
import { cn } from "~/lib/utils";

/**
 * One line of container output.
 *
 * Three formats, in order of how much is known about the line:
 *
 * 1. A JSON payload is tokenised and highlighted, and can be expanded to
 *    indented form — flat single-line JSON is the least readable thing in the
 *    pane, because the braces and field names weigh as much as the message.
 * 2. ANSI escapes become styling, because a program that coloured its own
 *    output already told us which parts matter.
 * 3. Runs the program left unstyled get `key=` dimmed, which separates the
 *    field names from the values in logfmt-style output without inventing a
 *    colour scheme on top of one the program may already be using.
 *
 * Every line can be selected like any text, and carries a copy button on
 * hover for the whole message - escapes stripped, since they are for a
 * terminal and not for whatever this is pasted into.
 */
export function LogLine({ text, className }: { text: string; className?: string | undefined }) {
  // Keyed by offset into the original line: spans are positional slices of an
  // immutable string, so where a run starts is its identity.
  // Escapes and JSON are mutually exclusive in practice, and a structured line
  // is worth more as JSON than as coloured text, so it is tried first.
  const json = React.useMemo(() => parseJsonLine(stripAnsi(text)), [text]);

  const spans = React.useMemo(
    () =>
      parseAnsi(text).reduce<Array<{ span: AnsiSpan; key: string }>>((acc, span, index) => {
        const previous = acc[index - 1];
        const offset = previous ? Number(previous.key) + previous.span.text.length : 0;
        acc.push({ span, key: String(offset) });
        return acc;
      }, []),
    [text],
  );

  if (json) {
    return <JsonLogLine line={json} className={className} />;
  }

  return (
    <span className={cn("group/line relative min-w-0 flex-1", className)}>
      <CopyLine text={() => stripAnsi(text)} />
      {spans.map(({ span, key }) =>
        span.className ? (
          <span key={key} className={span.className}>
            {span.text}
          </span>
        ) : (
          <LogfmtRun key={key} span={span} />
        ),
      )}
    </span>
  );
}

// `logger=`, `t=`, `msg=`, `app.config=` — a field name up to its equals.
// Deliberately narrow: a bare `=` inside prose shouldn't dim half a sentence.
const LOGFMT_KEY = /([\w.:-]+=)/g;

function LogfmtRun({ span }: { span: AnsiSpan }) {
  const parts = React.useMemo(
    () =>
      // split() with a capture group puts the matches at the odd indices; the
      // running offset gives each piece a stable identity within the run.
      span.text
        .split(LOGFMT_KEY)
        .reduce<Array<{ text: string; key: string; isKey: boolean }>>((acc, text, index) => {
          const previous = acc[index - 1];
          const offset = previous ? Number(previous.key) + previous.text.length : 0;
          acc.push({ text, key: String(offset), isKey: index % 2 === 1 });
          return acc;
        }, []),
    [span.text],
  );

  if (parts.length === 1) return <>{span.text}</>;

  return (
    <>
      {parts.map((part) =>
        part.isKey ? (
          <span key={part.key} className="text-muted-foreground/70">
            {part.text}
          </span>
        ) : (
          <React.Fragment key={part.key}>{part.text}</React.Fragment>
        ),
      )}
    </>
  );
}

/**
 * A structured line, collapsed to one line until asked otherwise.
 *
 * Expanding re-tokenises the re-serialised value rather than reflowing the
 * original text, so the indented form is genuinely valid JSON even when the
 * producer wrote it without spaces.
 *
 * Only the chevron toggles it. A line that expanded on any click could not
 * have a word double-clicked or a value dragged across, which is most of what
 * anyone does with a line of JSON. A copy takes the form on screen: indented
 * when expanded, the original single line when not.
 */
function JsonLogLine({
  line,
  className,
}: {
  line: NonNullable<ReturnType<typeof parseJsonLine>>;
  className?: string | undefined;
}) {
  const [expanded, setExpanded] = React.useState(false);

  const tokens = React.useMemo(
    () => (expanded ? tokenize(JSON.stringify(line.value, null, 2)) : line.tokens),
    [expanded, line],
  );

  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <span className={cn("group/line relative min-w-0 flex-1", className)}>
      <CopyLine text={() => jsonLineText(line, expanded)} />
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse this JSON" : "Expand this JSON"}
        title={expanded ? "Collapse" : "Expand this JSON"}
        className="mr-1 inline-grid size-3.5 cursor-pointer place-items-center rounded align-[-2px] text-muted-foreground/60 hover:bg-accent hover:text-foreground"
      >
        <Chevron className="size-3" strokeWidth={2} />
      </button>
      {line.prefix ? <span className="text-muted-foreground/70">{line.prefix}</span> : null}
      <span className={cn(expanded && "block whitespace-pre")}>
        <JsonTokens tokens={tokens} />
      </span>
    </span>
  );
}

function JsonTokens({ tokens }: { tokens: ReadonlyArray<JsonToken> }) {
  // Keyed by offset: tokens are positional slices of one immutable string.
  const keyed = React.useMemo(
    () =>
      tokens.reduce<Array<{ token: JsonToken; key: string }>>((acc, token, index) => {
        const previous = acc[index - 1];
        const offset = previous ? Number(previous.key) + previous.token.text.length : 0;
        acc.push({ token, key: String(offset) });
        return acc;
      }, []),
    [tokens],
  );

  return (
    <>
      {keyed.map(({ token, key }) =>
        token.kind === "whitespace" ? (
          <React.Fragment key={key}>{token.text}</React.Fragment>
        ) : (
          <span key={key} className={TOKEN_CLASS[token.kind]}>
            {token.text}
          </span>
        ),
      )}
    </>
  );
}

/**
 * The whole message to the clipboard, from the top right of its line.
 *
 * Hidden until the line is hovered or the button focused: a copy icon on every
 * line of a busy tail is a column of noise. The text is a thunk so nothing is
 * serialised for the thousands of lines nobody copies.
 */
function CopyLine({ text }: { text: () => string }) {
  const { copied, failed, copy } = useCopyToClipboard();
  const Icon = copied ? Check : failed ? X : Copy;

  return (
    <button
      type="button"
      onClick={() => void copy(text())}
      aria-label="Copy this line"
      title={copied ? "Copied" : failed ? "Copy failed" : "Copy this line"}
      className={cn(
        "absolute top-0 right-0 z-[1] grid size-5 cursor-pointer place-items-center rounded border border-border bg-card text-muted-foreground opacity-0 transition-opacity group-hover/line:opacity-100 hover:text-foreground focus-visible:opacity-100",
        copied && "text-success opacity-100",
        failed && "text-danger opacity-100",
      )}
    >
      <Icon className="size-3" strokeWidth={2} />
    </button>
  );
}
