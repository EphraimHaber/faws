import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { S3Connection } from "@faws/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSettingsStore, type SettingsStore } from "../settings/settings.store.ts";
import { createFileCredentialStore, createSettingsConnectionStore } from "./connectionStore.ts";

let dir: string;
let settingsPath: string;
let credentialsPath: string;
let settings: SettingsStore;

const connection: S3Connection = {
  id: "abc",
  name: "MinIO",
  endpoint: "https://s3.corp.internal:9000",
  region: "us-east-1",
  forcePathStyle: true,
  credentials: { mode: "stored", ref: "cred-1" },
  tls: {
    verify: true,
    caPaths: [],
    caPem: null,
    clientCertPath: null,
    clientKeyPath: null,
    servername: null,
    pinnedSha256: null,
  },
  features: { storageMetrics: false, presign: true },
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "faws-s3-connections-"));
  settingsPath = path.join(dir, "settings", "settings.json");
  credentialsPath = path.join(dir, "credentials", "s3.json");
  settings = createSettingsStore({ file: settingsPath });
  await settings.load();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function records() {
  return createSettingsConnectionStore(() => settings);
}

function credentials() {
  return createFileCredentialStore(credentialsPath);
}

describe("records", () => {
  it("keeps endpoints in the settings file, where every window already reads", async () => {
    await records().put(connection);
    await settings.flush();

    const onDisk = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      s3: { connections: S3Connection[] };
    };
    expect(onDisk.s3.connections).toEqual([connection]);
    expect(await records().get("abc")).toEqual(connection);
  });

  it("replaces an endpoint with the same id rather than adding a second", async () => {
    const store = records();
    await store.put(connection);
    await store.put({ ...connection, name: "MinIO (lab)", revision: 2 });

    expect(await store.list()).toHaveLength(1);
    expect((await store.get("abc"))?.name).toBe("MinIO (lab)");
  });

  it("removes one without disturbing the others", async () => {
    const store = records();
    await store.put(connection);
    await store.put({ ...connection, id: "def", name: "Ceph" });
    await store.remove("abc");

    expect((await store.list()).map((entry) => entry.id)).toEqual(["def"]);
  });
});

describe("credentials", () => {
  const credential = { accessKeyId: "AKIALOCAL", secretAccessKey: "s3cret" };

  it("writes keys to their own directory, not the file that is broadcast", async () => {
    await records().put(connection);
    await credentials().write("cred-1", credential);
    await settings.flush();

    expect(fs.readFileSync(settingsPath, "utf8")).not.toContain("s3cret");
    expect(fs.readFileSync(settingsPath, "utf8")).not.toContain("AKIALOCAL");
    expect(fs.readFileSync(credentialsPath, "utf8")).toContain("s3cret");
  });

  it("writes them only the owner can read", async () => {
    await credentials().write("cred-1", credential);

    expect(fs.statSync(credentialsPath).mode & 0o777).toBe(0o600);
  });

  it("reads back what a previous process wrote", async () => {
    await credentials().write("cred-1", { ...credential, sessionToken: "temporary" });

    expect(await credentials().read("cred-1")).toEqual({
      ...credential,
      sessionToken: "temporary",
    });
  });

  it("summarises which key is in use without the half that proves it", async () => {
    await credentials().write("cred-1", credential);

    expect(await credentials().summaries()).toEqual([
      {
        ref: "cred-1",
        accessKeyId: "AKIALOCAL",
        hasSessionToken: false,
        hasClientKeyPassphrase: false,
      },
    ]);
  });

  it("drops one without disturbing the others", async () => {
    const store = credentials();
    await store.write("cred-1", credential);
    await store.write("cred-2", { accessKeyId: "AKIAOTHER", secretAccessKey: "other" });
    await store.remove("cred-1");

    expect(await store.read("cred-1")).toBeNull();
    expect((await store.read("cred-2"))?.secretAccessKey).toBe("other");
  });

  it("serves endpoints even when the credentials cannot be read", async () => {
    await records().put(connection);
    fs.mkdirSync(path.dirname(credentialsPath), { recursive: true });
    fs.writeFileSync(credentialsPath, "{ not json");

    expect(await records().list()).toHaveLength(1);
    expect(await credentials().read("cred-1")).toBeNull();
  });

  it("keeps the entries it understands when one of them is nonsense", async () => {
    fs.mkdirSync(path.dirname(credentialsPath), { recursive: true });
    fs.writeFileSync(
      credentialsPath,
      JSON.stringify({ "cred-1": credential, "cred-2": { accessKeyId: 7 } }),
    );

    expect((await credentials().summaries()).map((entry) => entry.ref)).toEqual(["cred-1"]);
  });
});
