import { useMutation } from "@tanstack/react-query";
import * as React from "react";

import { Button } from "~/components/ui/button";
import { useClock } from "~/hooks/useClock";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { Switch } from "~/components/ui/switch";
import { TextAction } from "~/components/ui/text-action";
import { trpc } from "~/lib/trpc";
import { useSettings } from "~/stores/settings";

import { CertificateTrustDialog } from "./CertificateTrustDialog";

/** Soon enough to replace a CA before connections start failing. */
const EXPIRY_WARNING_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Every certificate this app trusts beyond the defaults, and where each came
 * from. Trust is reversible and visible here, which is what makes it safe to
 * offer from an error message.
 */
export function TrustPanel() {
  const trust = useSettings((state) => state.settings.trust);
  const [reviewing, setReviewing] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const remove = useMutation(trpc.trust.remove.mutationOptions());
  const system = useMutation(trpc.trust.setUseSystemStore.mutationOptions());
  const now = useClock(60 * 60 * 1000);

  return (
    <Panel className="shrink-0">
      <PanelHeader>
        <PanelTitle>Certificates</PanelTitle>
        <span className="ml-auto flex items-center gap-3">
          <TextAction onClick={() => setImporting((open) => !open)}>import PEM</TextAction>
          <TextAction onClick={() => setReviewing(true)}>check a host</TextAction>
        </span>
      </PanelHeader>
      <div className="flex flex-col gap-3 px-3.5 py-3">
        <label className="flex items-center gap-3 text-[12.5px]">
          <span className="min-w-0 flex-1">
            Trust this computer's certificate store
            <span className="block text-[12px] text-muted-foreground">
              Picks up a CA your IT department installed system-wide.
            </span>
          </span>
          <Switch
            aria-label="Trust this computer's certificate store"
            checked={trust.useSystemStore}
            disabled={system.isPending}
            onCheckedChange={(enabled) => system.mutate({ enabled })}
          />
        </label>

        {importing ? <ImportForm onDone={() => setImporting(false)} /> : null}

        {trust.entries.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            Only the default certificate authorities are trusted. A refused certificate offers to
            add its CA here.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {trust.entries.map((entry) => {
              const expiresSoon = Date.parse(entry.validTo) - now < EXPIRY_WARNING_MS;
              return (
                <li key={entry.id} className="flex items-start gap-3 px-3 py-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[12.5px]">
                      {entry.label}{" "}
                      <span className="font-mono text-[10px] text-muted-foreground uppercase">
                        {entry.kind === "ca" ? "CA" : "self-signed"}
                      </span>
                    </span>
                    <span
                      className="truncate font-mono text-[10.5px] text-muted-foreground"
                      title={entry.fingerprintSha256}
                    >
                      from {entry.addedFrom} · SHA-256 {entry.fingerprintSha256.slice(0, 23)}…
                    </span>
                    <span
                      className={
                        expiresSoon
                          ? "font-mono text-[10.5px] text-warning"
                          : "font-mono text-[10.5px] text-muted-foreground/70"
                      }
                    >
                      {expiresSoon ? "expires soon: " : "until "}
                      {new Date(entry.validTo).toLocaleDateString()}
                    </span>
                  </div>
                  <TextAction onClick={() => remove.mutate({ id: entry.id })}>remove</TextAction>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {reviewing ? <CertificateTrustDialog onClose={() => setReviewing(false)} /> : null}
    </Panel>
  );
}

function ImportForm({ onDone }: { onDone: () => void }) {
  const [pem, setPem] = React.useState("");
  const importPem = useMutation(trpc.trust.import.mutationOptions({ onSuccess: onDone }));
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        importPem.mutate({ pem, label: "" });
      }}
    >
      <textarea
        value={pem}
        onChange={(event) => setPem(event.target.value)}
        rows={5}
        placeholder="-----BEGIN CERTIFICATE-----"
        aria-label="Certificate in PEM form"
        className="rounded-md border border-border bg-background/50 px-2.5 py-2 font-mono text-[11px] focus:border-primary/50 focus:outline-none"
      />
      {importPem.isError ? (
        <p className="text-[12px] text-danger">{importPem.error.message}</p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="default" disabled={!pem.trim() || importPem.isPending}>
          Trust this certificate
        </Button>
      </div>
    </form>
  );
}
