import * as React from "react";

import { type AnsiSpan, parseAnsi, stripAnsi } from "~/lib/ansi";
import { type JsonToken, parseJsonLine, TOKEN_CLASS, tokenize } from "~/lib/json-log";
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
    <span className={cn("min-w-0 flex-1", className)}>
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

  return (
    <span className={cn("min-w-0 flex-1", className)}>
      {line.prefix ? <span className="text-muted-foreground/70">{line.prefix}</span> : null}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        title={expanded ? "Collapse" : "Expand this JSON"}
        className={cn(
          "cursor-pointer rounded text-left hover:bg-accent/40",
          expanded && "block whitespace-pre",
        )}
      >
        <JsonTokens tokens={tokens} />
      </button>
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
