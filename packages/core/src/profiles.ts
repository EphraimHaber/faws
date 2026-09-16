/**
 * Local AWS config discovery.
 *
 * Reads ~/.aws/config and ~/.aws/credentials through smithy's shared-ini
 * loader (which honours AWS_CONFIG_FILE / AWS_SHARED_CREDENTIALS_FILE), so
 * the profile picker shows exactly what the CLI would see.
 */
import { loadSharedConfigFiles } from "@smithy/shared-ini-file-loader";
import type { AwsProfile, AwsScope, Whoami } from "@faws/contracts";
import { GetCallerIdentityCommand } from "@aws-sdk/client-sts";

import { callAws, stsClient } from "./clients.ts";

export async function listProfiles(): Promise<AwsProfile[]> {
  const { configFile, credentialsFile } = await loadSharedConfigFiles();
  const seen = new Map<string, AwsProfile>();

  for (const [name, entry] of Object.entries(credentialsFile ?? {})) {
    seen.set(name, {
      name,
      region: entry["region"] ?? null,
      source: "credentials",
      sso: false,
    });
  }
  for (const [name, entry] of Object.entries(configFile ?? {})) {
    const sso = Boolean(entry["sso_session"] ?? entry["sso_start_url"] ?? entry["sso_account_id"]);
    const existing = seen.get(name);
    seen.set(name, {
      name,
      region: entry["region"] ?? existing?.region ?? null,
      source: existing?.source ?? "config",
      sso,
    });
  }

  return [...seen.values()].toSorted((a, b) => a.name.localeCompare(b.name));
}

/** Region the CLI would pick for a profile, before the UI override applies. */
export async function defaultRegionFor(profile: string): Promise<string | null> {
  const envRegion = process.env["AWS_REGION"] ?? process.env["AWS_DEFAULT_REGION"];
  if (envRegion) return envRegion;
  const profiles = await listProfiles();
  return profiles.find((p) => p.name === profile)?.region ?? null;
}

export async function whoami(scope: AwsScope): Promise<Whoami> {
  const client = stsClient(scope);
  const result = await callAws("sts", () => client.send(new GetCallerIdentityCommand({})));
  return {
    accountId: result.Account ?? "",
    arn: result.Arn ?? "",
    userId: result.UserId ?? "",
  };
}
