import type { ProviderId, SettingsPatch } from "@faws/contracts";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import * as React from "react";

import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { trpc } from "~/lib/trpc";
import { cn } from "~/lib/utils";
import { PROVIDERS, type ProviderDefinition } from "~/services/registry";
import { updateSettings, useSettings } from "~/stores/settings";

/**
 * First run: which of the things faws can talk to does this machine use?
 *
 * Pre-checked from what is on disk - an `~/.aws`, a kubeconfig and kubectl,
 * saved endpoints - so the usual answer is one click. Someone with no cloud
 * at all unticks AWS here and never sees it, and nothing reads `~/.aws` on
 * their behalf afterwards.
 */
export function WelcomePage() {
  const detection = useQuery({ ...trpc.providers.detect.queryOptions(), staleTime: Infinity });
  const stored = useSettings((state) => state.settings.providers);
  const [choice, setChoice] = React.useState<Partial<Record<ProviderId, boolean>>>({});

  const found = React.useMemo(
    () => new Map(detection.data?.map((entry) => [entry.id, entry]) ?? []),
    [detection.data],
  );

  // What a provider's switch shows: the person's own choice once they make
  // one, otherwise what detection suggests, otherwise what is stored.
  const isOn = (id: ProviderId) => choice[id] ?? found.get(id)?.found ?? stored[id].enabled;
  const anyOn = PROVIDERS.some((provider) => isOn(provider.id));

  const finish = (apply: boolean) => {
    updateSettings({
      ...(apply
        ? {
            providers: Object.fromEntries(
              PROVIDERS.map((provider) => [provider.id, { enabled: isOn(provider.id) }]),
            ) as SettingsPatch["providers"],
          }
        : {}),
      onboarding: { completed: true },
    });
  };

  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto bg-background px-4 py-10 text-foreground">
      <div className="flex w-full max-w-xl flex-col gap-7">
        <header className="flex flex-col gap-2">
          <span className="font-mono text-[10px] tracking-[0.3em] text-primary uppercase">
            faws · first run
          </span>
          <h1 className="text-[22px] font-semibold tracking-tight">What do you run?</h1>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Pick what this machine should connect to. Anything left off stays out of the way
            entirely - no pages, no menu entries, no calls - and can be switched on later in
            Settings.
          </p>
        </header>

        <ul className="flex flex-col gap-2">
          {PROVIDERS.map((provider) => (
            <ProviderChoice
              key={provider.id}
              provider={provider}
              on={isOn(provider.id)}
              evidence={found.get(provider.id)?.evidence}
              detected={found.get(provider.id)?.found ?? false}
              checking={detection.isPending}
              onChange={(next) => setChoice((prev) => ({ ...prev, [provider.id]: next }))}
            />
          ))}
        </ul>

        <footer className="flex items-center gap-3">
          <Button onClick={() => finish(true)}>{anyOn ? "Continue" : "Continue with none"}</Button>
          <button
            type="button"
            onClick={() => finish(false)}
            className="cursor-pointer text-[12px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Skip, keep everything on
          </button>
        </footer>
      </div>
    </div>
  );
}

function ProviderChoice({
  provider,
  on,
  evidence,
  detected,
  checking,
  onChange,
}: {
  provider: ProviderDefinition;
  on: boolean;
  evidence: string | undefined;
  detected: boolean;
  checking: boolean;
  onChange: (next: boolean) => void;
}) {
  const Icon = provider.icon;
  const labelId = `welcome-${provider.id}`;
  return (
    <li
      className={cn(
        "flex items-start gap-3.5 rounded-lg border bg-card px-4 py-3.5 transition-colors",
        on ? "border-primary/40" : "border-border",
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid size-8 shrink-0 place-items-center rounded-md border transition-colors",
          on
            ? "border-primary/35 bg-primary/10 text-primary"
            : "border-border text-muted-foreground",
        )}
      >
        <Icon className="size-4" strokeWidth={1.8} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p id={labelId} className="text-[13.5px] font-medium">
          {provider.label}
        </p>
        <p className="text-[12px] text-muted-foreground">{provider.description}</p>
        <p
          className={cn(
            "mt-1 flex items-center gap-1.5 font-mono text-[10.5px]",
            detected ? "text-success" : "text-muted-foreground/70",
          )}
        >
          {detected ? <Check className="size-3" strokeWidth={2.2} aria-hidden /> : null}
          {checking ? "Looking on this machine…" : (evidence ?? "")}
        </p>
      </div>
      <Switch aria-labelledby={labelId} checked={on} onCheckedChange={onChange} className="mt-1" />
    </li>
  );
}
