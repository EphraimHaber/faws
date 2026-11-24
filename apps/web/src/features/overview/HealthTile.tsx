import { Link } from "@tanstack/react-router";
import type * as React from "react";

import type { RefreshSource } from "~/components/refresh";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { StatusDot, type StatusTone } from "~/components/ui/status-dot";
import type { ProviderDefinition } from "~/services/registry";

export interface HealthFact {
  readonly label: string;
  readonly value: React.ReactNode;
}

/**
 * One provider's state at a glance: is it reachable, where is it pointed, and
 * where to go next.
 *
 * Every provider's tile is this component with different facts, so the
 * overview reads as one grid however many providers are on.
 */
export function HealthTile({
  provider,
  tone,
  headline,
  facts,
  refresh,
  to,
  action,
}: {
  provider: ProviderDefinition;
  tone: StatusTone;
  /** One line: what is true right now. */
  headline: string;
  facts: ReadonlyArray<HealthFact>;
  refresh?: RefreshSource;
  /** Where the tile's title leads. */
  to: string;
  action?: React.ReactNode;
}) {
  const Icon = provider.icon;
  return (
    <Panel className="min-w-0">
      <PanelHeader {...(refresh ? { refresh, refreshLabel: `Check ${provider.label} again` } : {})}>
        <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden />
        <Link to={to} className="min-w-0 truncate hover:text-foreground">
          <PanelTitle>{provider.label}</PanelTitle>
        </Link>
      </PanelHeader>
      <div className="flex flex-col gap-3 px-3.5 py-3">
        <p className="flex items-center gap-2 text-[12.5px]">
          <StatusDot tone={tone} />
          <span className="min-w-0 truncate">{headline}</span>
        </p>
        {facts.length > 0 ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[11px]">
            {facts.map((fact) => (
              <div key={fact.label} className="contents">
                <dt className="text-muted-foreground/70">{fact.label}</dt>
                <dd className="min-w-0 truncate text-foreground">{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {action ? <div className="flex items-center gap-2">{action}</div> : null}
      </div>
    </Panel>
  );
}
