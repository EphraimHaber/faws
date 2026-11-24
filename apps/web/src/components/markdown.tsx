import * as React from "react";

import { cn } from "~/lib/utils";

/**
 * The small part of markdown release notes use: paragraphs, links, inline
 * code and bold. Built as elements rather than HTML, so a note can never
 * inject markup, and links open outside the app.
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const paragraphs = source.split(/\n\s*\n/).filter((block) => block.trim().length > 0);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {paragraphs.map((paragraph) => (
        <p key={paragraph}>{inline(paragraph.replace(/\s*\n\s*/g, " "))}</p>
      ))}
    </div>
  );
}

const TOKEN = /\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*/g;

function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const [, linkText, href, code, bold] = match;
    if (linkText !== undefined && href !== undefined) {
      out.push(
        /^https?:\/\//.test(href) ? (
          <a
            key={at}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline-offset-2 hover:underline"
          >
            {inline(linkText)}
          </a>
        ) : (
          linkText
        ),
      );
    } else if (code !== undefined) {
      out.push(
        <code key={at} className="rounded bg-muted px-1 font-mono text-[0.92em]">
          {code}
        </code>,
      );
    } else if (bold !== undefined) {
      out.push(<strong key={at}>{bold}</strong>);
    }
    last = at + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
