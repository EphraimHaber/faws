import * as React from "react";

import { Button } from "~/components/ui/button";
import { findProvider, serviceForPath } from "~/services/registry";
import { setProviderEnabled, useProviderEnabled } from "~/stores/scope";

/**
 * Renders the page, unless it belongs to a provider that is switched off.
 *
 * One gate in the layout rather than a check on each route, so a bookmark, a
 * pinned link or a recent entry into a provider someone has since turned off
 * lands on a sentence and a way back, and no page of that provider mounts to
 * fire its queries.
 */
export function ProviderGate({
  pathname,
  children,
}: {
  pathname: string;
  children: React.ReactNode;
}) {
  const service = serviceForPath(pathname);
  const owner = service && service.owner !== "host" ? service.owner : null;
  if (!owner) return children;
  return <GateFor provider={owner}>{children}</GateFor>;
}

function GateFor({
  provider: id,
  children,
}: {
  provider: NonNullable<ReturnType<typeof findProvider>>["id"];
  children: React.ReactNode;
}) {
  const enabled = useProviderEnabled(id);
  if (enabled) return children;

  const provider = findProvider(id);
  if (!provider) return children;
  const Icon = provider.icon;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <Icon className="size-6 text-muted-foreground/45" strokeWidth={1.6} aria-hidden />
      <p className="text-[13px] text-foreground">{provider.label} is switched off</p>
      <p className="max-w-sm text-[12px] text-muted-foreground">
        Nothing here asks {provider.label} anything while it is off. Turn it on to see this page.
      </p>
      <Button size="sm" variant="default" onClick={() => setProviderEnabled(id, true)}>
        Turn on {provider.label}
      </Button>
    </div>
  );
}
