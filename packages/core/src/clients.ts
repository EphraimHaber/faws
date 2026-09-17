/**
 * AWS SDK client cache.
 *
 * Every fetcher takes an `AwsScope` (profile + region) rather than reading
 * ambient env, because the UI can switch either one at any time. Clients are
 * memoized per scope so we don't re-resolve credentials (which can mean an
 * SSO token read or a `credential_process` spawn) on every keystroke.
 */
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { ECSClient } from "@aws-sdk/client-ecs";
import { S3Client } from "@aws-sdk/client-s3";
import { STSClient } from "@aws-sdk/client-sts";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import type { AwsScope } from "@faws/contracts";
import { AwsRequestError, ProfileNotFoundError } from "@faws/contracts";

type ClientBundle = {
  readonly ecs: ECSClient;
  readonly sts: STSClient;
  readonly cloudwatch: CloudWatchClient;
  readonly logs: CloudWatchLogsClient;
  readonly s3: S3Client;
};

const bundles = new Map<string, ClientBundle>();

function scopeKey(scope: AwsScope): string {
  return `${scope.profile}::${scope.region}`;
}

function bundleFor(scope: AwsScope): ClientBundle {
  const key = scopeKey(scope);
  const existing = bundles.get(key);
  if (existing) return existing;

  // `fromNodeProviderChain` with an explicit profile covers static keys,
  // assume-role chains, credential_process, and SSO in one shot.
  const credentials = fromNodeProviderChain(scope.profile ? { profile: scope.profile } : {});
  const config = { region: scope.region, credentials };
  const bundle: ClientBundle = {
    ecs: new ECSClient(config),
    sts: new STSClient(config),
    cloudwatch: new CloudWatchClient(config),
    logs: new CloudWatchLogsClient(config),
    s3: new S3Client({
      ...config,
      // A bucket answers only in its own region; without this a request to the
      // wrong one fails with a redirect the caller would have to chase.
      followRegionRedirects: true,
    }),
  };
  bundles.set(key, bundle);
  return bundle;
}

export function ecsClient(scope: AwsScope): ECSClient {
  return bundleFor(scope).ecs;
}

export function stsClient(scope: AwsScope): STSClient {
  return bundleFor(scope).sts;
}

export function cloudWatchClient(scope: AwsScope): CloudWatchClient {
  return bundleFor(scope).cloudwatch;
}

export function logsClient(scope: AwsScope): CloudWatchLogsClient {
  return bundleFor(scope).logs;
}

export function s3Client(scope: AwsScope): S3Client {
  return bundleFor(scope).s3;
}

/** Drops cached clients for a scope so the next call re-resolves credentials. */
export function invalidateScope(scope: AwsScope): void {
  const key = scopeKey(scope);
  const bundle = bundles.get(key);
  if (!bundle) return;
  bundle.ecs.destroy();
  bundle.sts.destroy();
  bundle.cloudwatch.destroy();
  bundle.logs.destroy();
  bundles.delete(key);
}

/**
 * Runs an SDK call and re-throws SDK faults as our own error types, so the
 * tRPC layer can map them to stable codes without importing AWS types.
 */
export async function callAws<T>(service: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const name = (err as { name?: string }).name ?? "UnknownError";
    const message = err instanceof Error ? err.message : String(err);
    if (name === "CredentialsProviderError" || /could not be found/i.test(message)) {
      throw new ProfileNotFoundError(message);
    }
    throw new AwsRequestError(message, { code: name, service });
  }
}

/**
 * One page of a listing, with the cursor for the next one.
 *
 * The counterpart to `collectPages` for APIs whose result sets are unbounded:
 * the token is handed to the caller instead of being followed here.
 */
export interface Page<T> {
  readonly items: ReadonlyArray<T>;
  readonly nextToken: string | null;
}

/** Walks a paginated ECS list API, collecting every page's items. */
export async function collectPages<T>(
  page: (token: string | undefined) => Promise<{ items: ReadonlyArray<T>; nextToken?: string }>,
): Promise<T[]> {
  const out: T[] = [];
  let token: string | undefined;
  do {
    const result = await page(token);
    out.push(...result.items);
    token = result.nextToken;
  } while (token);
  return out;
}

/** DescribeServices caps at 10 ids per call; DescribeTasks at 100. */
export function chunk<T>(items: ReadonlyArray<T>, size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
