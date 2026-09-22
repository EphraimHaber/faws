import { describe, expect, it } from "vitest";

import { buildKubeArgv, type KubeBinaries, type KubeExecAuth, kubeScopeFlags } from "./argv.ts";

const BINARIES: KubeBinaries = {
  kubectl: "/usr/local/bin/kubectl",
  oc: "/usr/local/bin/oc",
  virtctl: "/usr/local/bin/virtctl",
  kubeconfig: "/home/dev/.kube/config",
};

function auth(target: KubeExecAuth["target"], overrides: Partial<KubeExecAuth> = {}): KubeExecAuth {
  return {
    kind: "kube",
    sessionId: "8f1d6a4c-4a1e-4f2b-9a2f-2f2a2c0f5d11",
    attach: false,
    record: true,
    cols: 120,
    rows: 40,
    context: "prod",
    namespace: "payments",
    target,
    ...overrides,
  };
}

describe("kubectl", () => {
  it("execs with a TTY and closes the flag list before the command", () => {
    const { file, args } = buildKubeArgv(
      auth({ tool: "kubectl", pod: "api-7d9f", container: "api", command: ["/bin/bash", "-l"] }),
      BINARIES,
    );

    expect(file).toBe("/usr/local/bin/kubectl");
    expect(args).toEqual([
      "--kubeconfig=/home/dev/.kube/config",
      "--context=prod",
      "--namespace=payments",
      "exec",
      "--stdin",
      "--tty",
      "api-7d9f",
      "--container=api",
      "--",
      "/bin/bash",
      "-l",
    ]);
  });

  it("omits the kubeconfig flag when there is no single file to pin", () => {
    const { args } = buildKubeArgv(auth({ tool: "kubectl", pod: "api", command: ["/bin/sh"] }), {
      ...BINARIES,
      kubeconfig: null,
    });

    expect(args[0]).toBe("--context=prod");
    expect(args.some((arg) => arg.startsWith("--kubeconfig"))).toBe(false);
  });
});

describe("oc", () => {
  it("rsh takes the command as positionals, with no separator", () => {
    const { file, args } = buildKubeArgv(
      auth({ tool: "oc", mode: "rsh", pod: "api-7d9f", container: "api", command: ["/bin/sh"] }),
      BINARIES,
    );

    expect(file).toBe("/usr/local/bin/oc");
    expect(args).toEqual([
      "--kubeconfig=/home/dev/.kube/config",
      "--context=prod",
      "--namespace=payments",
      "rsh",
      "--tty",
      "--container=api",
      "api-7d9f",
      "/bin/sh",
    ]);
  });

  it("exec is the kubectl form with oc as the file", () => {
    const { file, args } = buildKubeArgv(
      auth({ tool: "oc", mode: "exec", pod: "api-7d9f", command: ["/bin/sh"] }),
      BINARIES,
    );

    expect(file).toBe("/usr/local/bin/oc");
    expect(args).toContain("--");
    expect(args.at(-1)).toBe("/bin/sh");
  });
});

describe("virtctl", () => {
  it("pins the native ssh implementation", () => {
    const { file, args } = buildKubeArgv(
      auth({ tool: "virtctl", mode: "ssh", vm: "builder", user: "fedora" }),
      BINARIES,
    );

    expect(file).toBe("/usr/local/bin/virtctl");
    expect(args).toEqual([
      "--kubeconfig=/home/dev/.kube/config",
      "--context=prod",
      "--namespace=payments",
      "ssh",
      "fedora@builder",
      // Without this it shells out to the system ssh, which asks about host
      // keys on a TTY the child owns and we have no way to answer through.
      "--local-ssh=false",
    ]);
  });

  it("attaches a console", () => {
    const { args } = buildKubeArgv(
      auth({ tool: "virtctl", mode: "console", vm: "builder" }),
      BINARIES,
    );

    expect(args.slice(-2)).toEqual(["console", "builder"]);
  });
});

describe("the flag form", () => {
  it("never emits a value as a separate token", () => {
    // The contract's regexes would have refused this pod name; the point here
    // is that even if one got through, `--flag=value` leaves no token for
    // kubectl to read as a flag of its own.
    const { args } = buildKubeArgv(
      auth({ tool: "kubectl", pod: "-n", container: "-o", command: ["-c"] }, { context: "-x" }),
      BINARIES,
    );

    const separator = args.indexOf("--");
    for (const [index, arg] of args.entries()) {
      if (index > separator) continue;
      if (arg.startsWith("--") && !arg.includes("=")) {
        expect(["exec", "--stdin", "--tty", "--"]).toContain(arg);
      }
    }
    expect(args.filter((arg) => arg === "-n")).toEqual(["-n"]);
    expect(args.indexOf("-n")).toBeLessThan(separator);
    expect(args).toContain("--container=-o");
    expect(args).toContain("--context=-x");
  });
});

describe("a missing binary", () => {
  it("refuses with a code rather than spawning nothing", () => {
    expect(() =>
      buildKubeArgv(auth({ tool: "virtctl", mode: "console", vm: "builder" }), {
        ...BINARIES,
        virtctl: null,
      }),
    ).toThrow(/virtctl/);
  });
});

describe("kubeScopeFlags", () => {
  it("writes every part of the scope as a single --flag=value", () => {
    expect(
      kubeScopeFlags({ kubeconfig: "/home/dev/.kube/config", context: "-n", namespace: "-o" }),
    ).toEqual(["--kubeconfig=/home/dev/.kube/config", "--context=-n", "--namespace=-o"]);
  });

  it("leaves out the kubeconfig when none is pinned, and the namespace for cluster-wide reads", () => {
    expect(kubeScopeFlags({ kubeconfig: null, context: "prod", namespace: null })).toEqual([
      "--context=prod",
    ]);
  });
});
