import type { ExecPrompt } from "@faws/contracts";
import { ShieldQuestion } from "lucide-react";
import * as React from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { CopyButton } from "~/components/ui/copy-button";

/**
 * "This host is not one you have connected to before - is this its key?"
 *
 * Rendered inside the tab rather than as a modal. The question belongs to one
 * session, and a modal would block reading and typing in every other tab while
 * it stood open.
 *
 * Cancel is the default focus, and there is no timer that proceeds on its own.
 * Both implementations this replaces skipped the question entirely and trusted
 * the key; the whole point of the card is that somebody looks at the
 * fingerprint. Making it easy to dismiss with Enter would put that back.
 */
export function HostKeyPrompt({
  prompt,
  onRespond,
}: {
  prompt: Extract<ExecPrompt, { kind: "hostkey" }>;
  onRespond: (trust: "once" | "permanent" | "reject") => void;
}) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const [showLine, setShowLine] = React.useState(false);

  React.useEffect(() => {
    // Keyed on the prompt id so a second question in the same tab re-focuses
    // Cancel rather than leaving focus on whatever was clicked last.
    cancelRef.current?.focus();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [prompt.promptId]);

  return (
    <div className="shrink-0 border-b border-warning/40 bg-warning/5 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <ShieldQuestion className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium">Unrecognised host</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
            You have not connected to{" "}
            <span className="font-mono text-foreground">
              {prompt.host}:{prompt.port}
            </span>{" "}
            before. Check this fingerprint against the host itself before trusting it.
          </p>

          <div className="mt-1.5 flex items-center gap-1.5">
            <Badge tone="neutral">{prompt.keyType}</Badge>
            <code className="min-w-0 flex-1 truncate font-mono text-[11px]">
              {prompt.fingerprintSha256}
            </code>
            <CopyButton value={prompt.fingerprintSha256} />
          </div>

          <button
            type="button"
            onClick={() => setShowLine((shown) => !shown)}
            className="mt-1 text-[10.5px] text-muted-foreground underline-offset-2 hover:underline"
          >
            {showLine ? "Hide" : "Show"} the line this would add to known_hosts
          </button>
          {showLine ? (
            <pre className="mt-1 overflow-x-auto rounded-sm bg-muted/50 p-1.5 font-mono text-[10.5px]">
              {prompt.knownHostsLine}
            </pre>
          ) : null}

          <div className="mt-2 flex items-center gap-2">
            <Button ref={cancelRef} variant="ghost" onClick={() => onRespond("reject")}>
              Cancel
            </Button>
            <Button variant="ghost" onClick={() => onRespond("once")} title="Do not record it">
              Just this once
            </Button>
            <Button onClick={() => onRespond("permanent")} title="Append to ~/.ssh/known_hosts">
              Trust and connect
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
