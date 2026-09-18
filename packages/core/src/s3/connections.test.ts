import { s3ConnectionInputSchema, type S3ConnectionInput } from "@faws/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import {
  capabilitiesFor,
  credentialFor,
  deleteConnection,
  getConnection,
  saveConnection,
} from "./connections.ts";
import {
  createMemoryConnectionStore,
  createMemoryCredentialStore,
  credentialStore,
  registerConnectionStores,
} from "./store.ts";

function input(overrides: Partial<S3ConnectionInput> = {}): S3ConnectionInput {
  return s3ConnectionInputSchema.parse({
    name: "MinIO",
    endpoint: "https://s3.corp.internal:9000",
    credentialMode: "stored",
    accessKeyId: "AKIALOCAL",
    secretAccessKey: "s3cret",
    ...overrides,
  });
}

beforeEach(() => {
  registerConnectionStores({
    connections: createMemoryConnectionStore(),
    credentials: createMemoryCredentialStore(),
  });
});

describe("saveConnection", () => {
  it("stores the keys under a reference, and keeps neither in the record", async () => {
    const saved = await saveConnection(input());

    expect(JSON.stringify(saved)).not.toContain("s3cret");
    expect(JSON.stringify(saved)).not.toContain("AKIALOCAL");
    expect(saved.credentials).toEqual({ mode: "stored", ref: expect.any(String) });
    expect(await credentialFor(saved)).toEqual({
      accessKeyId: "AKIALOCAL",
      secretAccessKey: "s3cret",
    });
  });

  it("leaves a stored key alone when the field comes back blank", async () => {
    const saved = await saveConnection(input());
    const edited = await saveConnection(
      input({ id: saved.id, name: "MinIO (lab)", secretAccessKey: "" }),
    );

    expect(edited.name).toBe("MinIO (lab)");
    expect((await credentialFor(edited))?.secretAccessKey).toBe("s3cret");
  });

  it("keeps the same reference across edits, so no credential is stranded", async () => {
    const saved = await saveConnection(input());
    const edited = await saveConnection(input({ id: saved.id, secretAccessKey: "" }));

    expect(edited.credentials).toEqual(saved.credentials);
    expect(await credentialStore().summaries()).toHaveLength(1);
  });

  it("drops the credential when the endpoint stops signing with one", async () => {
    const saved = await saveConnection(input());
    const edited = await saveConnection(
      input({ id: saved.id, credentialMode: "anonymous", accessKeyId: undefined }),
    );

    expect(edited.credentials).toEqual({ mode: "anonymous" });
    expect(await credentialStore().summaries()).toEqual([]);
  });

  it("bumps the revision, so a cached client can tell it is stale", async () => {
    const saved = await saveConnection(input());
    const edited = await saveConnection(input({ id: saved.id, secretAccessKey: "" }));

    expect(edited.revision).toBe(saved.revision + 1);
  });
});

describe("deleteConnection", () => {
  it("takes the credential with it", async () => {
    const saved = await saveConnection(input());
    await deleteConnection(saved.id);

    expect(await credentialStore().summaries()).toEqual([]);
    await expect(getConnection(saved.id)).rejects.toThrow();
  });
});

describe("credential summaries", () => {
  it("name the key in use without the half that proves it", async () => {
    await saveConnection(input({ sessionToken: "temporary" }));

    expect(await credentialStore().summaries()).toEqual([
      {
        ref: expect.any(String),
        accessKeyId: "AKIALOCAL",
        hasSessionToken: true,
        hasClientKeyPassphrase: false,
      },
    ]);
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
      credentialMode: "stored",
      accessKeyId: "AKIALOCAL",
    });
    expect(create.success).toBe(false);

    const edit = s3ConnectionInputSchema.safeParse({
      id: "abc",
      name: "MinIO",
      endpoint: "https://s3.corp.internal:9000",
      credentialMode: "stored",
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

describe("switching an endpoint to stored keys", () => {
  it("refuses to save a credential with nothing in it", async () => {
    const saved = await saveConnection(
      input({ credentialMode: "anonymous", accessKeyId: undefined, secretAccessKey: undefined }),
    );

    await expect(
      saveConnection(
        input({
          id: saved.id,
          credentialMode: "stored",
          accessKeyId: undefined,
          secretAccessKey: undefined,
        }),
      ),
    ).rejects.toThrow(/access key id/i);
  });
});
