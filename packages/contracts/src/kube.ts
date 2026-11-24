/**
 * Flattened Kubernetes view models.
 *
 * Same contract as `s3.ts`: what the server fetchers produce and the tables
 * bind to, with the optionality already resolved. The Kubernetes API objects
 * these come from are deeply nested and mostly unread here - a pod's status
 * alone is four levels of arrays - so the flattening happens once, on the
 * server, rather than in every component that wants to know whether a shell
 * will work.
 *
 * Deliberately never the word "cluster": it means ECS everywhere else in this
 * app, and a column header reading "cluster" on a Kubernetes page would be the
 * one piece of vocabulary guaranteed to be misread.
 */
import { z } from "zod";

import { kubeContextSchema, kubeLabelSchema } from "./exec.ts";

/**
 * How a kubeconfig user authenticates. `token` and `certificate` are the
 * kinds faws can speak itself; `exec` and `auth-provider` run something.
 */
export type KubeAuthKind = "token" | "certificate" | "exec" | "auth-provider" | "basic" | "none";

/** One entry from the kubeconfig's `contexts` list. */
export interface KubeContextInfo {
  readonly name: string;
  /** The cluster entry it names, which is how two contexts reveal one target. */
  readonly clusterName: string;
  readonly userName: string;
  /** The context's own default namespace, if it sets one. */
  readonly namespace: string | null;
  readonly server: string | null;
  /** True for the kubeconfig's `current-context`. */
  readonly current: boolean;
  /**
   * The command this context authenticates with, when it uses an `exec`
   * credential plugin. Stated rather than left implicit: `~/.ssh/config` gets
   * the same treatment here, because a config file that runs a program is
   * something the person should know about before we spawn anything.
   */
  readonly execPlugin: string | null;
  readonly auth: KubeAuthKind;
}

export interface KubeNamespaceInfo {
  readonly name: string;
  /** `Active` or `Terminating`; a terminating namespace cannot take a new pod. */
  readonly phase: string;
  readonly createdAt: string | null;
}

export interface KubeContainerInfo {
  readonly name: string;
  readonly image: string;
  readonly ready: boolean;
  readonly restarts: number;
  /** `running`, `waiting` or `terminated`. */
  readonly state: string;
  /** `CrashLoopBackOff`, `ImagePullBackOff`, ... when there is one. */
  readonly reason: string | null;
  /** Init containers are listed, but nothing can be exec'd into one. */
  readonly init: boolean;
}

/**
 * A pod, with the columns that decide whether a shell will work.
 *
 * `execReady` follows the habit `ExecInstanceTarget.reachableBy` set: the
 * server has already joined phase and per-container readiness, so the UI does
 * not re-derive "can I press this" and get a different answer.
 */
export interface KubePodInfo {
  readonly name: string;
  readonly namespace: string;
  /** `Pending`, `Running`, `Succeeded`, `Failed`, `Unknown`. */
  readonly phase: string;
  readonly readyContainers: number;
  readonly totalContainers: number;
  readonly restarts: number;
  readonly nodeName: string | null;
  readonly podIp: string | null;
  readonly createdAt: string | null;
  readonly containers: ReadonlyArray<KubeContainerInfo>;
  /** Running, with at least one ready container that is not an init container. */
  readonly execReady: boolean;
}

/** A KubeVirt VirtualMachine, joined with its VirtualMachineInstance. */
export interface KubeVirtualMachineInfo {
  readonly name: string;
  readonly namespace: string;
  /** KubeVirt's own `printableStatus`: `Running`, `Stopped`, `Starting`, ... */
  readonly status: string;
  readonly running: boolean;
  /** The instance is up and its agent is reporting, so `virtctl ssh` can land. */
  readonly ready: boolean;
  readonly nodeName: string | null;
  readonly createdAt: string | null;
}

/** One external binary, as the diagnostics and degradation paths read it. */
export interface KubeBinaryInfo {
  readonly name: string;
  readonly found: boolean;
  /** Reported so "which kubectl is this" is answerable from the screen. */
  readonly path: string | null;
  readonly version: string | null;
  /** What to do about it when it is missing, in one actionable sentence. */
  readonly problem: string | null;
}

/**
 * Why a Kubernetes page is empty.
 *
 * Every failure here degrades to a page that says what is wrong and where we
 * looked, rather than an error: no `kubectl` and no kubeconfig are both
 * ordinary states for a machine that simply does not do Kubernetes.
 */
export interface KubeDiagnostics {
  readonly kubectl: KubeBinaryInfo;
  readonly oc: KubeBinaryInfo;
  readonly virtctl: KubeBinaryInfo;
  /**
   * The CLI lists and reads go through: `kubectl` when installed, else `oc`.
   * Null when neither is, which is the one state where nothing can be listed.
   */
  readonly reader: "kubectl" | "oc" | null;
  /** Every file the KUBECONFIG search covered, whether or not it exists. */
  readonly kubeconfigPaths: ReadonlyArray<string>;
  readonly kubeconfigFound: boolean;
  readonly currentContext: string | null;
  readonly contextNames: ReadonlyArray<string>;
  /** This is an OpenShift API server, so `oc rsh` is worth offering. */
  readonly openShift: boolean;
  /** KubeVirt is installed, so the virtual machines section has something in it. */
  readonly kubeVirt: boolean;
}

// ---------------------------------------------------------------------------
// Logging in

/** `alice/api-example-com:6443` is the user `alice`, as `oc login` names its user entries. */
export function kubeUserLabel(user: string): string {
  const slash = user.indexOf("/");
  return slash > 0 ? user.slice(0, slash) : user;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * An API server URL as the person typed it, made into an origin: `https://`
 * when no scheme is given, no path. Plain http is refused except to this
 * machine, since a token would otherwise cross the network in the clear.
 */
export const kubeServerSchema = z
  .string()
  .trim()
  .min(1, "Enter the API server URL.")
  .transform((value, ctx) => {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    let url: URL;
    try {
      url = new URL(withScheme);
    } catch {
      ctx.addIssue({ code: "custom", message: "Not a URL." });
      return z.NEVER;
    }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
      ctx.addIssue({ code: "custom", message: "The API server must use https." });
      return z.NEVER;
    }
    if (url.username || url.password) {
      ctx.addIssue({ code: "custom", message: "Leave credentials out of the URL." });
      return z.NEVER;
    }
    return url.origin;
  });

/** The first step of adding a cluster: where its API server is. */
export const kubeServerFormSchema = z.object({ server: kubeServerSchema });

/**
 * A bearer token, fenced to the characters tokens are made of so a pasted
 * value can never smuggle a header line.
 */
export const kubeTokenSchema = z
  .string()
  .trim()
  .min(1, "Paste a token.")
  .max(8192)
  .regex(/^[A-Za-z0-9._~+/=:-]+$/, "That is not a token: it has spaces or symbols in it.");

const optionalNamespace = z
  .string()
  .trim()
  .catch("")
  .refine((value) => value === "" || kubeLabelSchema.safeParse(value).success, {
    message: "Not a Kubernetes name.",
  });

/** The ways the login form signs in without leaving the app; `browser` has its own procedures. */
export const kubeLoginMethodSchema = z.enum(["password", "token"]);
export type KubeLoginMethod = z.infer<typeof kubeLoginMethodSchema> | "browser";

const credentials = {
  method: kubeLoginMethodSchema,
  username: z.string().trim().max(512).catch(""),
  password: z.string().max(4096).catch(""),
  token: z.string().trim().catch(""),
};

function requireCredentials(
  value: { method: "password" | "token"; username: string; password: string; token: string },
  ctx: z.RefinementCtx,
) {
  if (value.method === "password") {
    if (!value.username)
      ctx.addIssue({ code: "custom", path: ["username"], message: "Enter a username." });
    if (!value.password)
      ctx.addIssue({ code: "custom", path: ["password"], message: "Enter the password." });
    return;
  }
  const token = kubeTokenSchema.safeParse(value.token);
  if (!token.success) {
    ctx.addIssue({
      code: "custom",
      path: ["token"],
      message: token.error.issues[0]?.message ?? "Paste a token.",
    });
  }
}

/** The login form's fields: credentials, plus the namespace a new login starts in. */
export const kubeLoginFormSchema = z
  .object({ namespace: optionalNamespace, ...credentials })
  .superRefine(requireCredentials);
export type KubeLoginFormInput = z.input<typeof kubeLoginFormSchema>;
export type KubeLoginFormValues = z.output<typeof kubeLoginFormSchema>;

/** Logging in to an API server, writing the context `oc login` would. */
export const kubeLoginInputSchema = z
  .object({ server: kubeServerSchema, namespace: optionalNamespace, ...credentials })
  .superRefine(requireCredentials);
export type KubeLoginInput = z.input<typeof kubeLoginInputSchema>;
export type KubeLoginValues = z.output<typeof kubeLoginInputSchema>;

/** Logging in again to an existing context, keeping its server and user. */
export const kubeReloginInputSchema = z
  .object({ context: kubeContextSchema, ...credentials })
  .superRefine(requireCredentials);
export type KubeReloginInput = z.input<typeof kubeReloginInputSchema>;
export type KubeReloginValues = z.output<typeof kubeReloginInputSchema>;

/** Starting a sign in through the browser, for a new server or an existing context. */
export const kubeBrowserLoginStartSchema = z.union([
  z.object({ server: kubeServerSchema, namespace: optionalNamespace }),
  z.object({ context: kubeContextSchema }),
]);

export const kubeBrowserLoginIdSchema = z.object({ loginId: z.uuid() });

/** Whether a TLS handshake with one host succeeds with what this app trusts. */
export interface KubeTlsVerdict {
  readonly host: string;
  readonly port: number;
  readonly authorized: boolean;
  /** OpenSSL's code when refused, e.g. SELF_SIGNED_CERT_IN_CHAIN. */
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

/** Where an OpenShift cluster's OAuth server takes logins. */
export interface KubeOAuthEndpoints {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  /** The page that hands out a token to paste. */
  readonly tokenRequestUrl: string;
  readonly pkce: boolean;
}

/** What an API server is, before anything is written. */
export interface KubeClusterProbe {
  readonly server: string;
  readonly reachable: boolean;
  /** Why it could not be reached, when it could not. */
  readonly problem: string | null;
  readonly api: KubeTlsVerdict | null;
  readonly openShift: boolean;
  readonly oauth: KubeOAuthEndpoints | null;
  /** The OAuth host presents its own certificate, often from another CA. */
  readonly oauthTls: KubeTlsVerdict | null;
  /** `gitVersion` from `/version`, when the server answers it anonymously. */
  readonly version: string | null;
}

/** What a login wrote. */
export interface KubeLoginResult {
  readonly context: string;
  readonly server: string;
  readonly user: string;
  readonly namespace: string;
  readonly kubeconfig: string;
  /** A CA this app trusts was written for the cluster, so `oc` and `kubectl` trust it too. */
  readonly wroteCertificateAuthority: boolean;
  readonly expiresAt: string | null;
}

export interface KubeBrowserLoginStart {
  readonly loginId: string;
  readonly authorizeUrl: string;
}

export interface KubeLogoutResult {
  readonly context: string;
  /** The server forgot the token too, rather than only this machine. */
  readonly revoked: boolean;
}

/**
 * A context's login, as the context list shows it; never the token itself.
 * `unknown` covers a context faws cannot ask about without running something
 * (an exec plugin), and a cluster that did not answer.
 */
export interface KubeLoginStatus {
  readonly context: string;
  readonly state: "valid" | "expired" | "logged-out" | "unknown";
  readonly expiresAt: string | null;
}
