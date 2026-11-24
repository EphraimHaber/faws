import type { KubeContextInfo } from "@faws/contracts";
import { describe, expect, it } from "vitest";

import { KubeCliError } from "./cli.ts";
import { KubeUnauthorizedError } from "./errors.ts";
import { readFailure } from "./resources.ts";

const context: KubeContextInfo = {
  name: "dev/api-ocp-example-com:6443/alice",
  clusterName: "api-ocp-example-com:6443",
  userName: "alice/api-ocp-example-com:6443",
  namespace: "dev",
  server: "https://api.ocp.example.com:6443",
  current: true,
  execPlugin: null,
};

function cliError(stderr: string): KubeCliError {
  return new KubeCliError(stderr, { exitCode: 1, stderr });
}

describe("a failed read", () => {
  it("names the context, server and user when the token has expired", () => {
    const err = readFailure(
      cliError("error: You must be logged in to the server (Unauthorized)"),
      context,
    );
    expect(err).toBeInstanceOf(KubeUnauthorizedError);
    expect((err as KubeUnauthorizedError).toCause()).toMatchObject({
      kind: "KubeUnauthorized",
      context: context.name,
      server: context.server,
      user: context.userName,
    });
    expect(err.message).toContain("as alice");
  });

  it("keeps any other failure as a coded exec error", () => {
    const err = readFailure(
      cliError("Unable to connect to the server: dial tcp 10.0.0.1:6443: i/o timeout"),
      context,
    );
    expect(err).not.toBeInstanceOf(KubeUnauthorizedError);
    expect((err as { code?: string }).code).toBe("KubeApiUnreachable");
  });
});
