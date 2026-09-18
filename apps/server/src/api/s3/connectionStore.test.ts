import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { S3Connection } from "@faws/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSettingsStore, type SettingsStore } from "../settings/settings.store.ts";
import { createServerConnectionStore } from "./connectionStore.ts";

let dir: string;
let settingsPath: string;
let secretsPath: string;
let settings: SettingsStore;

const connection: S3Connection = {
  id: "abc",
  source: "stored",
  name: "MinIO",
  endpoint: "https://s3.corp.internal:9000",
  region: "us-east-1",
  forcePathStyle: true,
  credentials: { mode: "static", accessKeyId: "AKIALOCAL" },
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
  secretKeys: ["secretAccessKey"],
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "faws-s3-connections-"));
  settingsPath = path.join(dir, "settings", "settings.json");
  secretsPath = path.join(dir, "settings", "s3-secrets.json");
  settings = createSettingsStore({ file: settingsPath });
  await settings.load();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function store() {
  return createServerConnectionStore({ settings, secretsFile: secretsPath });
}

describe("records", () => {
  it("keeps endpoints in the settings file, where every window already reads", async () => {
    await store().put(connection);
    await settings.flush();

    const onDisk = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      s3: { connections: S3Connection[] };
    };
    expect(onDisk.s3.connections).toEqual([connection]);
    expect(await store().get("abc")).toEqual(connection);
  });

  it("replaces an endpoint with the same id rather than adding a second", async () => {
    const connections = store();
    await connections.put(connection);
    await connections.put({ ...connection, name: "MinIO (lab)", revision: 2 });

    expect(await connections.list()).toHaveLength(1);
    expect((await connections.get("abc"))?.name).toBe("MinIO (lab)");
  });

  it("removes one without disturbing the others", async () => {
    const connections = store();
    await connections.put(connection);
    await connections.put({ ...connection, id: "def", name: "Ceph" });
    await connections.remove("abc");

    expect((await connections.list()).map((entry) => entry.id)).toEqual(["def"]);
  });
});

describe("secrets", () => {
  it("writes keys to their own file, not the one that is broadcast", async () => {
    await store().put(connection);
    await store().writeSecret({ connectionId: "abc", name: "secretAccessKey" }, "s3cret");
    await settings.flush();

    expect(fs.readFileSync(settingsPath, "utf8")).not.toContain("s3cret");
    expect(fs.readFileSync(secretsPath, "utf8")).toContain("s3cret");
  });

  it("writes them only the owner can read", async () => {
    await store().writeSecret({ connectionId: "abc", name: "secretAccessKey" }, "s3cret");

    expect(fs.statSync(secretsPath).mode & 0o777).toBe(0o600);
  });

  it("reads back what a previous process wrote", async () => {
    await store().writeSecret({ connectionId: "abc", name: "secretAccessKey" }, "s3cret");

    expect(await store().readSecret({ connectionId: "abc", name: "secretAccessKey" })).toBe(
      "s3cret",
    );
  });

  it("drops every key of a connection, and leaves other connections' alone", async () => {
    const connections = store();
    await connections.writeSecret({ connectionId: "abc", name: "secretAccessKey" }, "one");
    await connections.writeSecret({ connectionId: "def", name: "secretAccessKey" }, "two");
    await connections.removeSecrets("abc");

    expect(
      await connections.readSecret({ connectionId: "abc", name: "secretAccessKey" }),
    ).toBeNull();
    expect(await connections.readSecret({ connectionId: "def", name: "secretAccessKey" })).toBe(
      "two",
    );
  });

  it("serves endpoints even when the keys cannot be read", async () => {
    await store().put(connection);
    fs.mkdirSync(path.dirname(secretsPath), { recursive: true });
    fs.writeFileSync(secretsPath, "{ not json");

    const connections = store();
    expect(await connections.list()).toHaveLength(1);
    expect(
      await connections.readSecret({ connectionId: "abc", name: "secretAccessKey" }),
    ).toBeNull();
  });
});
