import {
  DEFAULT_SETTINGS,
  type KubeScopeSettings,
  type Settings,
  type SettingsPatch,
} from "@faws/contracts";
import { describe, expect, it } from "vitest";

import { createOutbox } from "./outbox.ts";

/** A snapshot as the server would send it, written before any local change. */
function fromServer(kube: Partial<KubeScopeSettings> = {}): Settings {
  const kubernetes = DEFAULT_SETTINGS.providers.kubernetes;
  return {
    ...DEFAULT_SETTINGS,
    providers: {
      ...DEFAULT_SETTINGS.providers,
      kubernetes: { ...kubernetes, scope: { ...kubernetes.scope, ...kube } },
    },
  };
}

/** A patch pointing the Kubernetes pages somewhere. */
function kube(scope: Partial<KubeScopeSettings>): SettingsPatch {
  return { providers: { kubernetes: { scope } } };
}

describe("outbox", () => {
  it("keeps a queued change on screen when an older snapshot lands", () => {
    const outbox = createOutbox();
    outbox.queue(kube({ context: "prod" }));
    expect(outbox.show(fromServer()).providers.kubernetes.scope.context).toBe("prod");
  });

  it("keeps a sent change on screen until the server confirms it", () => {
    const outbox = createOutbox();
    outbox.queue(kube({ context: "prod" }));
    const sent = outbox.take();
    expect(sent?.patch).toEqual(kube({ context: "prod" }));
    expect(outbox.show(fromServer()).providers.kubernetes.scope.context).toBe("prod");

    outbox.settle(sent!.id);
    // Confirmed, so the server is right again - even when it has since moved on.
    expect(outbox.show(fromServer({ context: "staging" })).providers.kubernetes.scope.context).toBe(
      "staging",
    );
  });

  it("settles only the send an answer belongs to", () => {
    const outbox = createOutbox();
    outbox.queue(kube({ context: "prod" }));
    const first = outbox.take()!;
    outbox.queue(kube({ namespace: "payments" }));
    outbox.take();

    outbox.settle(first.id);
    const shown = outbox.show(fromServer({ context: "prod" }));
    expect(shown.providers.kubernetes.scope).toEqual({ context: "prod", namespace: "payments" });
  });

  it("has nothing to send when nothing is queued", () => {
    const outbox = createOutbox();
    expect(outbox.take()).toBeNull();
    outbox.queue({ logs: {} });
    expect(outbox.take()).toBeNull();
  });
});
