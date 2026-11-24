import type { PresentedCertificate } from "@faws/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import * as React from "react";

import { Dialog } from "~/components/Dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { LoadingRows } from "~/components/ui/spinner";
import { trpc } from "~/lib/trpc";
import { cn } from "~/lib/utils";

/**
 * What a host presents, and the choice to trust part of it.
 *
 * Shows the chain top down - the root a person recognises first - with the
 * one certificate that would fix the refusal ticked: the topmost CA not
 * already trusted. Trusting takes an explicit click on a button that names
 * what is being trusted, and is refused outright for a certificate that is
 * expired or issued to another name, which no trust decision can fix.
 */
export function CertificateTrustDialog({
  host: initialHost = "",
  port: initialPort = 443,
  onClose,
}: {
  host?: string;
  port?: number;
  onClose: () => void;
}) {
  const [target, setTarget] = React.useState(
    initialHost ? { host: initialHost, port: initialPort } : null,
  );

  return (
    <Dialog
      id="trust-certificate"
      title="Review certificate"
      onClose={onClose}
      className="max-w-2xl"
    >
      {target ? (
        <ChainReview target={target} onDone={onClose} onChangeHost={() => setTarget(null)} />
      ) : (
        <HostForm host={initialHost} port={initialPort} onSubmit={(next) => setTarget(next)} />
      )}
    </Dialog>
  );
}

function HostForm({
  host,
  port,
  onSubmit,
}: {
  host: string;
  port: number;
  onSubmit: (target: { host: string; port: number }) => void;
}) {
  const [value, setValue] = React.useState(host ? `${host}:${port}` : "");
  const parsed = parseTarget(value);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed) onSubmit(parsed);
      }}
    >
      <p className="text-[12.5px] text-muted-foreground">
        The host whose certificate was refused - an endpoint, or the proxy between this machine and
        AWS.
      </p>
      <Input
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="minio.internal:9000"
        aria-label="Host and port"
      />
      <div className="flex justify-end">
        <Button type="submit" variant="default" disabled={!parsed}>
          Look at its certificate
        </Button>
      </div>
    </form>
  );
}

export function parseTarget(value: string): { host: string; port: number } | null {
  const trimmed = value
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  const match = /^([^:\s]+)(?::(\d{1,5}))?$/.exec(trimmed);
  if (!match?.[1]) return null;
  const port = match[2] ? Number(match[2]) : 443;
  return port > 0 && port < 65536 ? { host: match[1], port } : null;
}

function ChainReview({
  target,
  onDone,
  onChangeHost,
}: {
  target: { host: string; port: number };
  onDone: () => void;
  onChangeHost: () => void;
}) {
  const queryClient = useQueryClient();
  const chain = useQuery({ ...trpc.trust.inspect.queryOptions(target), retry: false });
  const [picked, setPicked] = React.useState<ReadonlySet<string> | null>(null);

  const topDown = React.useMemo(() => [...(chain.data?.chain ?? [])].toReversed(), [chain.data]);
  const suggested = React.useMemo(() => {
    if (!chain.data?.fixableByTrust) return new Set<string>();
    const first = topDown.find(trustable);
    return new Set(first ? [first.fingerprintSha256] : []);
  }, [topDown, chain.data]);
  const selected = picked ?? suggested;

  const add = useMutation(
    trpc.trust.add.mutationOptions({
      onSuccess: () => {
        // Every query that failed on this certificate gets another go.
        void queryClient.invalidateQueries();
        onDone();
      },
    }),
  );

  if (chain.isPending) return <LoadingRows />;
  // Not ErrorState: that component offers this dialog, and a refused handshake
  // here is a message, not something to review again.
  if (chain.isError) {
    return (
      <div className="flex flex-col gap-3">
        <p className="font-mono text-[12px] text-danger">{chain.error.message}</p>
        <div className="flex justify-end gap-2">
          <Button onClick={onChangeHost}>Another host</Button>
          <Button onClick={() => void chain.refetch()}>Retry</Button>
        </div>
      </div>
    );
  }

  const data = chain.data;
  const names = topDown
    .filter((cert) => selected.has(cert.fingerprintSha256))
    .map((c) => c.commonName || c.subject);

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-[12.5px]">
        {data.authorized ? (
          <ShieldCheck className="size-4 text-success" strokeWidth={1.8} aria-hidden />
        ) : (
          <ShieldAlert className="size-4 text-danger" strokeWidth={1.8} aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          <span className="font-mono">
            {data.host}:{data.port}
          </span>{" "}
          {data.authorized ? "is trusted." : (data.errorMessage ?? "is not trusted.")}
        </span>
        <button
          type="button"
          onClick={onChangeHost}
          className="text-[11.5px] text-muted-foreground hover:text-foreground"
        >
          another host
        </button>
      </p>

      <ol className="flex flex-col gap-1.5">
        {topDown.map((cert, index) => (
          <CertificateRow
            key={cert.fingerprintSha256}
            cert={cert}
            depth={index}
            checked={selected.has(cert.fingerprintSha256)}
            disabled={!trustable(cert) || !data.fixableByTrust}
            onToggle={(on) => {
              const next = new Set(selected);
              if (on) next.add(cert.fingerprintSha256);
              else next.delete(cert.fingerprintSha256);
              setPicked(next);
            }}
          />
        ))}
      </ol>

      {!data.authorized && !data.fixableByTrust ? (
        <p className="rounded-md border border-warning/40 bg-warning/8 px-3 py-2 text-[12px]">
          Trusting a certificate would not fix this. An expired certificate, or one issued for a
          different name, stays refused; for a saved S3 endpoint, its TLS settings can name the
          server or pin its certificate instead.
        </p>
      ) : null}

      {add.isError ? <p className="text-[12px] text-danger">{add.error.message}</p> : null}

      <div className="flex items-center justify-end gap-2">
        <Button onClick={onDone}>Cancel</Button>
        {data.fixableByTrust ? (
          <Button
            variant="default"
            disabled={selected.size === 0 || add.isPending}
            onClick={() => add.mutate({ ...target, fingerprints: [...selected] })}
          >
            {add.isPending ? "Trusting…" : `Trust ${names.join(" and ") || "selected"}`}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Only a CA or a self-signed certificate means anything as a trust anchor. */
function trustable(cert: PresentedCertificate): boolean {
  return (cert.isCA || cert.selfSigned) && !cert.trusted;
}

function CertificateRow({
  cert,
  depth,
  checked,
  disabled,
  onToggle,
}: {
  cert: PresentedCertificate;
  depth: number;
  checked: boolean;
  disabled: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <li style={{ marginLeft: depth * 14 }}>
      <label
        className={cn(
          "flex items-start gap-2.5 rounded-md border border-border px-3 py-2",
          checked && "border-primary/45 bg-primary/5",
          disabled ? "cursor-default" : "cursor-pointer",
        )}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onToggle(event.target.checked)}
          className="mt-0.5 size-3.5 accent-primary"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
            {cert.commonName || cert.subject}
            {cert.isCA ? <Badge>CA</Badge> : null}
            {cert.selfSigned ? <Badge>self-signed</Badge> : null}
            {cert.trusted ? <Badge tone="success">trusted</Badge> : null}
            {cert.expired ? <Badge tone="danger">expired</Badge> : null}
          </span>
          <span
            className="truncate font-mono text-[10.5px] text-muted-foreground"
            title={cert.subject}
          >
            issued by {cert.issuer} · until {new Date(cert.validTo).toLocaleDateString()}
          </span>
          <span
            className="truncate font-mono text-[10px] text-muted-foreground/70"
            title={cert.fingerprintSha256}
          >
            SHA-256 {cert.fingerprintSha256}
          </span>
        </span>
      </label>
    </li>
  );
}
