import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { loadYaml } from "@kubernetes/client-node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  backupPath,
  clusterNickname,
  mergeLogin,
  parseKubeconfig,
  type RawKubeconfig,
  setUserToken,
  targetKubeconfig,
  updateKubeconfig,
} from "./kubeconfigWriter.ts";

const EXISTING = `apiVersion: v1
kind: Config
clusters:
  - name: eks-prod
    cluster:
      server: https://ABC.gr7.eu-west-1.eks.amazonaws.com
      certificate-authority-data: QUJD
      proxy-url: http://proxy.corp:3128
users:
  - name: eks-prod
    user:
      exec:
        apiVersion: client.authentication.k8s.io/v1beta1
        command: aws
        args: [eks, get-token, --cluster-name, prod]
        interactiveMode: Never
contexts:
  - name: eks-prod
    context:
      cluster: eks-prod
      user: eks-prod
current-context: eks-prod
preferences: {}
extensions:
  - name: keep-me
    extension:
      note: untouched
`;

let dir = "";
let file = "";
const savedEnv = process.env["KUBECONFIG"];

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "faws-kubeconfig-"));
  file = path.join(dir, "config");
});

afterEach(async () => {
  if (savedEnv === undefined) delete process.env["KUBECONFIG"];
  else process.env["KUBECONFIG"] = savedEnv;
  await fs.rm(dir, { recursive: true, force: true });
});

const login = {
  server: "https://api.ocp.example.com:6443",
  username: "alice",
  token: "sha256~secret",
  namespace: "payments",
  certificateAuthority: null,
};

describe("names", () => {
  it("follow oc login", () => {
    const doc: RawKubeconfig = {};
    expect(mergeLogin(doc, login)).toEqual({
      cluster: "api-ocp-example-com:6443",
      user: "alice/api-ocp-example-com:6443",
      context: "payments/api-ocp-example-com:6443/alice",
    });
    expect(doc["current-context"]).toBe("payments/api-ocp-example-com:6443/alice");
  });

  it("always carry a port", () => {
    expect(clusterNickname("https://api.example.com")).toBe("api-example-com:443");
    expect(clusterNickname("http://127.0.0.1:8080")).toBe("127-0-0-1:8080");
  });

  it("put the target in the first KUBECONFIG file", () => {
    process.env["KUBECONFIG"] = [path.join(dir, "a"), path.join(dir, "b")].join(path.delimiter);
    expect(targetKubeconfig()).toBe(path.join(dir, "a"));
  });
});

describe("merging", () => {
  it("leaves every other entry and unknown field as it was", async () => {
    await fs.writeFile(file, EXISTING, { mode: 0o640 });
    await updateKubeconfig(file, (doc) => mergeLogin(doc, login));
    const after = loadYaml<RawKubeconfig>(await fs.readFile(file, "utf8"));
    const before = loadYaml<RawKubeconfig>(EXISTING);

    expect(after.clusters?.[0]).toEqual(before.clusters?.[0]);
    expect(after.users?.[0]).toEqual(before.users?.[0]);
    expect(after.contexts?.[0]).toEqual(before.contexts?.[0]);
    expect(after["extensions"]).toEqual(before["extensions"]);
    expect(after.clusters).toHaveLength(2);
    expect(after.users?.[1]).toEqual({
      name: "alice/api-ocp-example-com:6443",
      user: { token: "sha256~secret" },
    });
  });

  it("updates an existing login in place instead of adding a second", async () => {
    await updateKubeconfig(file, (doc) => mergeLogin(doc, login));
    await updateKubeconfig(file, (doc) => mergeLogin(doc, { ...login, token: "sha256~fresh" }));
    const after = parseKubeconfig(await fs.readFile(file, "utf8"));
    expect(after.users).toHaveLength(1);
    expect(after.contexts).toHaveLength(1);
    expect(after.users?.[0]?.user?.["token"]).toBe("sha256~fresh");
  });

  it("writes a trusted CA inline and drops a CA file path, never skipping verification", async () => {
    const doc = parseKubeconfig(
      "clusters:\n  - name: api-ocp-example-com:6443\n    cluster:\n      server: https://api.ocp.example.com:6443\n      certificate-authority: /etc/old-ca.pem\n",
    );
    mergeLogin(doc, { ...login, certificateAuthority: "-----BEGIN CERTIFICATE-----\nX\n" });
    const cluster = doc.clusters?.[0]?.cluster ?? {};
    expect(cluster["certificate-authority"]).toBeUndefined();
    expect(
      Buffer.from(String(cluster["certificate-authority-data"]), "base64").toString(),
    ).toContain("BEGIN CERTIFICATE");
    expect(JSON.stringify(doc)).not.toContain("insecure-skip-tls-verify");
  });

  it("clears a token for logout and leaves the user entry", () => {
    const doc: RawKubeconfig = {};
    const written = mergeLogin(doc, login);
    expect(setUserToken(doc, written.user, null)).toBe(true);
    expect(doc.users?.[0]).toEqual({ name: written.user, user: {} });
    expect(setUserToken(doc, "nobody", null)).toBe(false);
  });
});

describe("writing", () => {
  it("creates a new file as 0600 inside a new directory", async () => {
    const nested = path.join(dir, ".kube", "config");
    await updateKubeconfig(nested, (doc) => mergeLogin(doc, login));
    expect((await fs.stat(nested)).mode & 0o777).toBe(0o600);
    await expect(fs.stat(backupPath(nested))).rejects.toThrow();
  });

  it("keeps an existing file's mode", async () => {
    await fs.writeFile(file, EXISTING);
    await fs.chmod(file, 0o640);
    await updateKubeconfig(file, (doc) => mergeLogin(doc, login));
    expect((await fs.stat(file)).mode & 0o777).toBe(0o640);
  });

  it("backs up the original once, before the first write only", async () => {
    await fs.writeFile(file, EXISTING);
    await updateKubeconfig(file, (doc) => mergeLogin(doc, login));
    await updateKubeconfig(file, (doc) => mergeLogin(doc, { ...login, token: "sha256~again" }));
    expect(await fs.readFile(backupPath(file), "utf8")).toBe(EXISTING);
    expect((await fs.stat(backupPath(file))).mode & 0o777).toBe(0o600);
  });

  it("writes through a symlink to the real file", async () => {
    const real = path.join(dir, "real-config");
    await fs.writeFile(real, EXISTING);
    await fs.symlink(real, file);
    await updateKubeconfig(file, (doc) => mergeLogin(doc, login));
    expect((await fs.lstat(file)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(real, "utf8")).toContain("alice/api-ocp-example-com:6443");
  });

  it("leaves the original untouched and no temp file behind when a change fails", async () => {
    await fs.writeFile(file, EXISTING);
    await expect(
      updateKubeconfig(file, () => {
        throw new Error("refused");
      }),
    ).rejects.toThrow("refused");
    expect(await fs.readFile(file, "utf8")).toBe(EXISTING);
    expect((await fs.readdir(dir)).toSorted()).toEqual(["config"]);
  });

  it("serialises concurrent changes so none is lost", async () => {
    await Promise.all(
      ["a", "b", "c", "d", "e"].map((name) =>
        updateKubeconfig(file, (doc) => mergeLogin(doc, { ...login, username: name })),
      ),
    );
    const after = parseKubeconfig(await fs.readFile(file, "utf8"));
    expect(after.users?.map((entry) => entry.name).toSorted()).toEqual([
      "a/api-ocp-example-com:6443",
      "b/api-ocp-example-com:6443",
      "c/api-ocp-example-com:6443",
      "d/api-ocp-example-com:6443",
      "e/api-ocp-example-com:6443",
    ]);
    // No temp or lock file is left behind.
    expect((await fs.readdir(dir)).toSorted()).toEqual(["config", "config.faws-backup"]);
  });

  it("waits for, then gives up on, a lock held by another program", async () => {
    await fs.writeFile(`${file}.lock`, "");
    await expect(updateKubeconfig(file, (doc) => mergeLogin(doc, login))).rejects.toThrow(
      /held by another program/,
    );
    await expect(fs.stat(file)).rejects.toThrow();
  }, 10_000);
});
