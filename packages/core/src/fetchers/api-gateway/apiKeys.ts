import { type ApiKey as AwsApiKey, GetApiKeysCommand } from "@aws-sdk/client-api-gateway";
import type { ApiKey, ApiKeyListing, AwsScope } from "@faws/contracts";
import { toIso } from "@faws/shared";

import { apiGatewayClient, callAws } from "../../clients.ts";

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
  const keys: ApiKey[] = [];
  let position: string | undefined;
  let pages = 0;
  do {
    const page = await callAws("apigateway", () =>
      client.send(new GetApiKeysCommand({ limit: 500, ...(position ? { position } : {}) })),
    );
    for (const item of page.items ?? []) {
      const key = apiKey(item);
      if (key) keys.push(key);
    }
    position = page.position;
    pages += 1;
  } while (position && pages < MAX_KEY_PAGES);

  return {
    keys: keys.toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    truncated: Boolean(position),
  };
}
