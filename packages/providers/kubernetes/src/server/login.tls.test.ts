import { X509Certificate } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as tls from "node:tls";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { anchorsFor, appTrustedCAs } from "./auth/tls.ts";
import { forgetKubeContexts } from "./kubeconfig.ts";
import { parseKubeconfig } from "./kubeconfigWriter.ts";
import { login, probeCluster } from "./login.ts";
import { LOCALHOST_CERT, LOCALHOST_KEY, TEST_CA, UNRELATED_CA } from "./testing/certificates.ts";
import { type FakeOpenShift, startFakeOpenShift } from "./testing/fakeOpenShift.ts";

const defaults = tls.getCACertificates("default");
let dir = "";
let fake: FakeOpenShift;
const savedEnv = process.env["KUBECONFIG"];

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "faws-login-tls-"));
  process.env["KUBECONFIG"] = path.join(dir, "config");
  forgetKubeContexts();
  fake = await startFakeOpenShift({ tls: { key: LOCALHOST_KEY, cert: LOCALHOST_CERT } });
});

afterEach(async () => {
  tls.setDefaultCACertificates(defaults);
  await fake.close();
  if (savedEnv === undefined) delete process.env["KUBECONFIG"];
  else process.env["KUBECONFIG"] = savedEnv;
  await fs.rm(dir, { recursive: true, force: true });
});

/** What the app does when the person trusts a CA: it joins Node's default set. */
function trustInApp(pem: string) {
  tls.setDefaultCACertificates([...tls.getCACertificates("bundled"), pem]);
}

describe("a cluster behind an internal CA", () => {
  it("is reported untrusted, and asks nothing more until trusted", async () => {
    const probe = await probeCluster(fake.url);
    expect(probe.reachable).toBe(true);
    expect(probe.api?.authorized).toBe(false);
    expect(probe.api?.errorCode).toBe("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    expect(probe.oauth).toBeNull();
    expect(fake.requests).toEqual([]);
  });

  it("refuses a login with the app's own trust error", async () => {
    await expect(
      login({
        method: "password",
        username: "alice",
        password: "wonderland",
        token: "",
        server: fake.url,
        namespace: "",
      }),
    ).rejects.toMatchObject({ kind: "EndpointTrustError" });
  });

  it("once trusted in the app, writes that CA into the kubeconfig for oc and kubectl", async () => {
    trustInApp(TEST_CA);
    const probe = await probeCluster(fake.url);
    expect(probe.api?.authorized).toBe(true);
    expect(probe.oauthTls?.authorized).toBe(true);
    expect(probe.openShift).toBe(true);

    const result = await login({
      method: "password",
      username: "alice",
      password: "wonderland",
      token: "",
      server: fake.url,
      namespace: "",
    });
    expect(result.wroteCertificateAuthority).toBe(true);

    const doc = parseKubeconfig(await fs.readFile(path.join(dir, "config"), "utf8"));
    const cluster = doc.clusters?.[0]?.cluster ?? {};
    const written = Buffer.from(String(cluster["certificate-authority-data"]), "base64").toString();
    expect(new X509Certificate(written).fingerprint256).toBe(
      new X509Certificate(TEST_CA).fingerprint256,
    );
    expect(cluster["insecure-skip-tls-verify"]).toBeUndefined();
  });
});

describe("anchors", () => {
  it("are the trusted CAs that issued the chain, and nothing else", () => {
    const chain = [new X509Certificate(LOCALHOST_CERT)];
    expect(anchorsFor(chain, [UNRELATED_CA, TEST_CA]).map((pem) => pem.trim())).toEqual([
      new X509Certificate(TEST_CA).toString().trim(),
    ]);
    expect(anchorsFor(chain, [UNRELATED_CA])).toEqual([]);
  });

  it("leave out Node's bundled roots", () => {
    trustInApp(TEST_CA);
    expect(appTrustedCAs()).toEqual([TEST_CA.trim()]);
  });
});
