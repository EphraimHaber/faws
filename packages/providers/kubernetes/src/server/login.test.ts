import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { httpRequest } from "./auth/http.ts";
import { forgetKubeContexts } from "./kubeconfig.ts";
import { parseKubeconfig } from "./kubeconfigWriter.ts";
import {
  completeBrowserLogin,
  login,
  logout,
  probeCluster,
  relogin,
  startBrowserLogin,
} from "./login.ts";
import { type FakeOpenShift, startFakeOpenShift } from "./testing/fakeOpenShift.ts";

let dir = "";
let file = "";
let fake: FakeOpenShift;
const savedEnv = process.env["KUBECONFIG"];

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "faws-login-"));
  file = path.join(dir, "config");
  process.env["KUBECONFIG"] = file;
  forgetKubeContexts();
  fake = await startFakeOpenShift();
});

afterEach(async () => {
  await fake.close();
  if (savedEnv === undefined) delete process.env["KUBECONFIG"];
  else process.env["KUBECONFIG"] = savedEnv;
  await fs.rm(dir, { recursive: true, force: true });
});

const cluster = () => `127-0-0-1:${new URL(fake.url).port}`;
const read = async () => parseKubeconfig(await fs.readFile(file, "utf8"));
const password = {
  method: "password" as const,
  username: "alice",
  password: "wonderland",
  token: "",
};

describe("probing", () => {
  it("recognises OpenShift and its OAuth server", async () => {
    const probe = await probeCluster(fake.url);
    expect(probe).toMatchObject({ reachable: true, openShift: true, version: "v1.31.4" });
    expect(probe.oauth?.tokenRequestUrl).toBe(`${fake.url}/oauth/token/request`);
  });

  it("says why a server cannot be reached", async () => {
    await fake.close();
    const probe = await probeCluster(fake.url);
    expect(probe.reachable).toBe(false);
    expect(probe.problem).toMatch(/could not be reached/);
  });
});

describe("logging in", () => {
  it("writes the cluster, user and context oc would, in the default project", async () => {
    const result = await login({ ...password, server: fake.url, namespace: "" });
    expect(result.context).toBe(`default/${cluster()}/alice`);
    expect(result.user).toBe(`alice/${cluster()}`);
    expect(result.expiresAt).not.toBeNull();

    const doc = await read();
    expect(doc["current-context"]).toBe(result.context);
    expect(doc.clusters?.[0]?.cluster).toEqual({ server: fake.url });
    const token = String(doc.users?.[0]?.user?.["token"]);
    expect(fake.tokens.get(token)?.user).toBe("alice");
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  });

  it("takes a pasted token and asks the cluster whose it is", async () => {
    const token = fake.issueToken("bob");
    const result = await login({
      method: "token",
      username: "",
      password: "",
      token,
      server: fake.url,
      namespace: "payments",
    });
    expect(result.context).toBe(`payments/${cluster()}/bob`);
  });

  it("refuses a bad token without writing anything", async () => {
    await expect(
      login({
        method: "token",
        username: "",
        password: "",
        token: "sha256~nope",
        server: fake.url,
        namespace: "",
      }),
    ).rejects.toThrow(/did not accept that token/);
    await expect(fs.stat(file)).rejects.toThrow();
  });

  it("renews an expired login in place", async () => {
    const first = await login({ ...password, server: fake.url, namespace: "" });
    const stale = String((await read()).users?.[0]?.user?.["token"]);
    fake.tokens.delete(stale);

    const again = await relogin({ ...password, username: "", context: first.context });
    expect(again.context).toBe(first.context);
    const doc = await read();
    expect(doc.users).toHaveLength(1);
    expect(doc.users?.[0]?.user?.["token"]).not.toBe(stale);
  });

  it("signs in through the browser", async () => {
    const started = await startBrowserLogin({ server: fake.url, namespace: "" });
    const waiting = completeBrowserLogin(started.loginId);
    const redirect = await httpRequest(started.authorizeUrl);
    await httpRequest(String(redirect.headers.location));
    const result = await waiting;
    expect(result.context).toBe(`default/${cluster()}/alice`);
    await expect(completeBrowserLogin(started.loginId)).rejects.toThrow(/finished or expired/);
  });

  it("cancels a browser sign in when its waiting request is aborted", async () => {
    const started = await startBrowserLogin({ server: fake.url, namespace: "" });
    const abort = new AbortController();
    const waiting = completeBrowserLogin(started.loginId, { signal: abort.signal });
    abort.abort();
    await expect(waiting).rejects.toThrow(/cancelled/);
  });
});

describe("logging out", () => {
  it("revokes the token on the server and clears it from the kubeconfig", async () => {
    const result = await login({ ...password, server: fake.url, namespace: "" });
    const token = String((await read()).users?.[0]?.user?.["token"]);
    expect(await logout(result.context)).toEqual({ context: result.context, revoked: true });
    expect(fake.revoked).toEqual([token]);
    const doc = await read();
    expect(doc.users?.[0]).toEqual({ name: result.user, user: {} });
    expect(doc.contexts).toHaveLength(1);
  });
});
