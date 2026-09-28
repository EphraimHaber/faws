import { type ApiKey as AwsApiKey, GetApiKeysCommand } from "@aws-sdk/client-api-gateway";
import type { ApiKey, ApiKeyListing, AwsScope } from "@faws/contracts";
import { toIso } from "@faws/shared";

import { apiGatewayClient, callAws, collectPagesUpTo } from "../../clients.ts";

/** GetApiKeys returns at most 500 a page. */
const MAX_KEY_PAGES = 10;

/** A stage key, `{restApiId}/{stageName}`, split; `null` when it is not that shape. */
export function stageKeyTarget(stageKey: string): { apiId: string; stage: string } | null {
  const cut = stageKey.indexOf("/");
  if (cut <= 0 || cut === stageKey.length - 1) return null;
  return { apiId: stageKey.slice(0, cut), stage: stageKey.slice(cut + 1) };
}

/**
 * A listed key, or `null` for one without an id. Only named fields are
 * copied, so a value AWS sends anyway goes no further.
 */
export function apiKey(key: AwsApiKey): ApiKey | null {
  if (!key.id) return null;
  return {
    id: key.id,
    name: key.name || key.id,
    description: key.description || null,
    customerId: key.customerId || null,
    enabled: key.enabled ?? false,
    createdAt: toIso(key.createdDate),
    updatedAt: toIso(key.lastUpdatedDate),
    stageKeys: (key.stageKeys ?? []).flatMap((stageKey) => {
      const target = stageKeyTarget(stageKey);
      return target ? [target] : [];
    }),
    tags: key.tags ?? {},
  };
}

/**
 * Every API key in the region, by name, up to a cap. `includeValues` is left
 * unset, so AWS sends no key's value.
 */
export async function listApiKeys(scope: AwsScope): Promise<ApiKeyListing> {
  const client = apiGatewayClient(scope);
  const { items, truncated } = await collectPagesUpTo(MAX_KEY_PAGES, async (position) => {
    const page = await callAws("apigateway", () =>
      client.send(new GetApiKeysCommand({ limit: 500, ...(position ? { position } : {}) })),
    );
    return { items: page.items ?? [], ...(page.position ? { nextToken: page.position } : {}) };
  });

  return {
    keys: items
      .flatMap((item) => apiKey(item) ?? [])
      .toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    truncated,
  };
}
