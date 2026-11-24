import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { KubeContextInfo } from "@faws/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { KubeUnauthorizedError } from "./errors.ts";
import { mergeLogin, updateKubeconfig } from "./kubeconfigWriter.ts";
import { nativeReaderFor } from "./nativeReads.ts";
import { LOCALHOST_CERT, LOCALHOST_KEY, TEST_CA } from "./testing/certificates.ts";
import { type FakeOpenShift, startFakeOpenShift } from "./testing/fakeOpenShift.ts";

let dir = "";
let file = "";
let fake: FakeOpenShift;
const savedEnv = process.env["KUBECONFIG"];

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "faws-native-"));
  file = path.join(dir, "config");
  process.env["KUBECONFIG"] = file;
  fake = await startFakeOpenShift({
    tls: { key: LOCALHOST_KEY, cert: LOCALHOST_CERT },
    pods: 4,
  });
});

afterEach(async () => {
  await fake.close();
  if (savedEnv === undefined) delete process.env["KUBECONFIG"];
  else process.env["KUBECONFIG"] = savedEnv;
  await fs.rm(dir, { recursive: true, force: true });
});

/** Writes a login for the fake with its CA in the kubeconfig, as a login through faws would. */
async function loginWith(token: string): Promise<KubeContextInfo> {
  const written = await updateKubeconfig(file, (doc) =>
    mergeLogin(doc, {
      server: fake.url,
      username: "alice",
      token,
      namespace: "default",
      certificateAuthority: TEST_CA,
    }),
  );
  return {
    name: written.context,
    clusterName: written.cluster,
    userName: written.user,
    namespace: "default",
    server: fake.url,
    current: true,
    execPlugin: null,
    auth: "token",
  };
}

describe("reading in process", () => {
  it("lists pods with the kubeconfig's token and CA, with no app trust involved", async () => {
    const context = await loginWith(fake.issueToken("alice"));
    const reader = nativeReaderFor(context);
    expect(reader).not.toBeNull();
    const pods = await reader!.list({ kind: "pods", namespace: "default" });
    expect(pods.items).toHaveLength(4);
    expect(fake.requests).toContain("GET /api/v1/namespaces/default/pods");
  });

  it("reports an expired token as an expired login", async () => {
    const context = await loginWith("sha256~expired");
    await expect(nativeReaderFor(context)!.list({ kind: "namespaces" })).rejects.toBeInstanceOf(
      KubeUnauthorizedError,
    );
  });

  it("stops when the caller gives up", async () => {
    const context = await loginWith(fake.issueToken("alice"));
    const abort = new AbortController();
    abort.abort();
    await expect(
      nativeReaderFor(context)!.list({ kind: "namespaces" }, abort.signal),
    ).rejects.toMatchObject({ code: "KubeApiUnreachable" });
  });

  it("leaves exec plugin contexts to the CLI", async () => {
    const context = await loginWith(fake.issueToken("alice"));
    expect(nativeReaderFor({ ...context, auth: "exec", execPlugin: "aws" })).toBeNull();
  });

  it("leaves a cluster that skips verification to the CLI", async () => {
    const context = await loginWith(fake.issueToken("alice"));
    const text = await fs.readFile(file, "utf8");
    await fs.writeFile(
      file,
      text.replace("certificate-authority-data:", "insecure-skip-tls-verify: true\n      x:"),
    );
    expect(nativeReaderFor(context)).toBeNull();
  });
});
