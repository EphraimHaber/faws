import { s3ConnectionInputSchema, type S3ConnectionInput } from "@faws/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createMemorySettingsStore,
  registerSettingsStore,
  settingsStore,
} from "../settings/store.ts";
import {
  capabilitiesFor,
  connectionSecret,
  deleteConnection,
  saveConnection,
} from "./connections.ts";

function input(overrides: Partial<S3ConnectionInput> = {}): S3ConnectionInput {
  return s3ConnectionInputSchema.parse({
    name: "MinIO",
    endpoint: "https://s3.corp.internal:9000",
    credentialMode: "static",
    accessKeyId: "AKIALOCAL",
    secretAccessKey: "s3cret",
    ...overrides,
  });
}

beforeEach(() => {
  registerSettingsStore(createMemorySettingsStore());
});

describe("saveConnection", () => {
  it("keeps the secret out of the record and says only that one is set", async () => {
    const saved = await saveConnection(input());

    expect(JSON.stringify(saved)).not.toContain("s3cret");
    expect(saved.secretKeys).toEqual(["secretAccessKey"]);
    expect(await connectionSecret(saved, "secretAccessKey")).toBe("s3cret");
  });

  it("leaves a stored secret alone when the field comes back blank", async () => {
    const saved = await saveConnection(input());
    const edited = await saveConnection(
      input({ id: saved.id, name: "MinIO (lab)", secretAccessKey: "" }),
    );

    expect(edited.name).toBe("MinIO (lab)");
    expect(await connectionSecret(edited, "secretAccessKey")).toBe("s3cret");
  });

  it("drops keys the connection no longer signs with", async () => {
    const saved = await saveConnection(input());
    const edited = await saveConnection(
      input({ id: saved.id, credentialMode: "anonymous", accessKeyId: undefined }),
    );

    expect(edited.secretKeys).toEqual([]);
    expect(
      await settingsStore().readSecret({ connectionId: edited.id, name: "secretAccessKey" }),
    ).toBeNull();
  });

  it("bumps the revision, so a cached client can tell it is stale", async () => {
    const saved = await saveConnection(input());
    const edited = await saveConnection(input({ id: saved.id, secretAccessKey: "" }));

    expect(edited.revision).toBe(saved.revision + 1);
  });
});

describe("deleteConnection", () => {
  it("takes the secrets with it", async () => {
    const saved = await saveConnection(input());
    await deleteConnection(saved.id);

    expect(
      await settingsStore().readSecret({ connectionId: saved.id, name: "secretAccessKey" }),
    ).toBeNull();
  });
});

describe("capabilitiesFor", () => {
  it("offers everything when the scope points at AWS", async () => {
    expect(await capabilitiesFor({ profile: "default", region: "us-east-1" })).toEqual({
      bucketRegions: true,
      storageMetrics: true,
      presign: true,
    });
  });

  it("withholds what only AWS answers when the scope points at an endpoint", async () => {
    const saved = await saveConnection(input());

    expect(
      await capabilitiesFor({ profile: "default", region: "us-east-1", connectionId: saved.id }),
    ).toEqual({ bucketRegions: false, storageMetrics: false, presign: true });
  });
});

describe("s3ConnectionInputSchema", () => {
  it("requires a secret for a new connection and not for an edit", () => {
    const create = s3ConnectionInputSchema.safeParse({
      name: "MinIO",
      endpoint: "https://s3.corp.internal:9000",
      credentialMode: "static",
      accessKeyId: "AKIALOCAL",
    });
    expect(create.success).toBe(false);

    const edit = s3ConnectionInputSchema.safeParse({
      id: "abc",
      name: "MinIO",
      endpoint: "https://s3.corp.internal:9000",
      credentialMode: "static",
      accessKeyId: "AKIALOCAL",
    });
    expect(edit.success).toBe(true);
  });

  it("refuses an endpoint carrying a path", () => {
    const parsed = s3ConnectionInputSchema.safeParse({
      name: "MinIO",
      endpoint: "https://s3.corp.internal:9000/buckets",
      credentialMode: "anonymous",
    });
    expect(parsed.success).toBe(false);
  });

  it("reads untouched optional fields as absent rather than as empty values", () => {
    const parsed = input({ tls: { caPaths: [""], caPem: "", servername: "" } as never });

    expect(parsed.tls.caPaths).toEqual([]);
    expect(parsed.tls.caPem).toBeNull();
    expect(parsed.tls.servername).toBeNull();
  });

  it("takes a fingerprint in the form openssl prints and stores it upper case", () => {
    const pin = Array.from({ length: 32 }, () => "ab").join(":");
    const parsed = input({ tls: { pinnedSha256: pin } as never });

    expect(parsed.tls.pinnedSha256).toBe(pin.toUpperCase());
  });

  it("refuses a fingerprint that is not 32 bytes", () => {
    const parsed = s3ConnectionInputSchema.safeParse({
      name: "MinIO",
      endpoint: "https://s3.corp.internal:9000",
      credentialMode: "anonymous",
      tls: { pinnedSha256: "ab:cd" },
    });
    expect(parsed.success).toBe(false);
  });
});
