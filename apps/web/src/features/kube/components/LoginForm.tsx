import {
  type KubeClusterProbe,
  type KubeLoginFormValues,
  type KubeLoginMethod,
  type KubeLoginResult,
  kubeLoginFormSchema,
} from "@faws/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Globe } from "lucide-react";
import * as React from "react";

import {
  Form,
  FormActions,
  FormError,
  SubmitButton,
  TextField,
  useZodForm,
} from "~/components/form";
import { Segmented } from "~/components/segmented";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { textActionClass } from "~/components/ui/text-action";
import { CertificateTrustDialog } from "~/features/trust/CertificateTrustDialog";
import { openExternal } from "~/lib/desktop";
import { untrustedEndpoint } from "~/lib/errorCause";
import { trpc } from "~/lib/trpc";

/** A new login to a server, or a renewal of an existing context's. */
export type LoginTarget =
  | { readonly kind: "new"; readonly server: string }
  | { readonly kind: "relogin"; readonly context: string; readonly username: string };

const METHOD_LABEL: Record<KubeLoginMethod, string> = {
  password: "Password",
  browser: "Browser",
  token: "Token",
};

/**
 * Choosing how to sign in, and doing it. OpenShift offers a password, a
 * browser sign in and a pasted token; a plain Kubernetes API server takes a
 * token only.
 */
export function LoginForm({
  target,
  probe,
  onDone,
  onCancel,
}: {
  target: LoginTarget;
  probe: KubeClusterProbe;
  onDone: (result: KubeLoginResult) => void;
  onCancel: () => void;
}) {
  const methods: KubeLoginMethod[] = probe.openShift ? ["password", "browser", "token"] : ["token"];
  const [method, setMethod] = React.useState<KubeLoginMethod>(methods[0] ?? "token");

  return (
    <div className="flex flex-col gap-3">
      {methods.length > 1 ? (
        <Segmented
          options={methods.map((value) => ({ value, label: METHOD_LABEL[value] }))}
          value={method}
          onChange={setMethod}
          className="self-start"
        />
      ) : (
        <p className="text-[12px] text-muted-foreground">
          This is not an OpenShift cluster, so it takes a bearer token: a service account&apos;s, or
          one your identity provider issued.
        </p>
      )}
      {method === "browser" ? (
        <BrowserSignIn target={target} onDone={onDone} onCancel={onCancel} />
      ) : (
        <CredentialsForm
          key={method}
          method={method}
          target={target}
          probe={probe}
          onDone={onDone}
          onCancel={onCancel}
        />
      )}
    </div>
  );
}

function CredentialsForm({
  method,
  target,
  probe,
  onDone,
  onCancel,
}: {
  method: "password" | "token";
  target: LoginTarget;
  probe: KubeClusterProbe;
  onDone: (result: KubeLoginResult) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [reviewing, setReviewing] = React.useState(false);
  const form = useZodForm(kubeLoginFormSchema, {
    defaultValues: {
      method,
      username: target.kind === "relogin" ? target.username : "",
      password: "",
      token: "",
      namespace: "",
    },
  });
  const done = {
    onSuccess: (result: KubeLoginResult) => {
      void queryClient.invalidateQueries();
      onDone(result);
    },
  };
  const login = useMutation(trpc.kubernetes.login.mutationOptions(done));
  const relogin = useMutation(trpc.kubernetes.relogin.mutationOptions(done));
  const pending = login.isPending || relogin.isPending;
  const error = login.error ?? relogin.error;
  const untrusted = untrustedEndpoint(error);

  const submit = (values: KubeLoginFormValues) => {
    if (target.kind === "new") login.mutate({ ...values, server: target.server });
    else relogin.mutate({ ...values, context: target.context });
  };

  return (
    <Form form={form} onSubmit={submit}>
      {method === "password" ? (
        <>
          <TextField name="username" label="Username" autoFocus={target.kind === "new"} mono />
          <TextField
            name="password"
            label="Password"
            secret
            autoFocus={target.kind === "relogin"}
          />
        </>
      ) : (
        <>
          <TextField
            name="token"
            label="Token"
            hint="Kept in your kubeconfig, as oc keeps it."
            secret
            mono
            autoFocus
          />
          {probe.oauth ? (
            <a
              href={probe.oauth.tokenRequestUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                event.preventDefault();
                openExternal(probe.oauth?.tokenRequestUrl ?? "");
              }}
              className={`${textActionClass} inline-flex items-center gap-1 self-start text-[12px]`}
            >
              Get a token from the cluster <ExternalLink className="size-3" />
            </a>
          ) : null}
        </>
      )}
      {target.kind === "new" ? (
        <TextField
          name="namespace"
          label="Namespace"
          hint="Leave empty to start where oc login would."
          placeholder="default"
          mono
        />
      ) : null}
      <FormError error={error} />
      {untrusted ? (
        <Button type="button" className="self-start" onClick={() => setReviewing(true)}>
          Review certificate
        </Button>
      ) : null}
      <FormActions>
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
        <SubmitButton variant="default" pending={pending}>
          Log in
        </SubmitButton>
      </FormActions>
      {reviewing && untrusted ? (
        <CertificateTrustDialog
          {...(untrusted.host ? { host: untrusted.host, port: untrusted.port } : {})}
          onClose={() => setReviewing(false)}
        />
      ) : null}
    </Form>
  );
}

/**
 * Opens the cluster's sign in page in the person's browser and waits for it
 * to come back to faws. The link stays on screen in case the browser did not
 * open, or opened somewhere unexpected.
 */
function BrowserSignIn({
  target,
  onDone,
  onCancel,
}: {
  target: LoginTarget;
  onDone: (result: KubeLoginResult) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const start = useMutation(trpc.kubernetes.startBrowserLogin.mutationOptions());
  const complete = useMutation(
    trpc.kubernetes.completeBrowserLogin.mutationOptions({
      onSuccess: (result) => {
        void queryClient.invalidateQueries();
        onDone(result);
      },
    }),
  );
  const cancel = useMutation(trpc.kubernetes.cancelBrowserLogin.mutationOptions());
  const loginId = start.data?.loginId ?? null;
  const waiting = complete.isPending;

  // Leaving the dialog mid sign in stops the listener rather than leaving it open.
  const live = React.useRef<string | null>(null);
  React.useEffect(() => {
    live.current = waiting ? loginId : null;
  }, [waiting, loginId]);
  const cancelLogin = cancel.mutate;
  React.useEffect(
    () => () => {
      if (live.current) cancelLogin({ loginId: live.current });
    },
    [cancelLogin],
  );

  const begin = () => {
    complete.reset();
    start.mutate(
      target.kind === "new"
        ? { server: target.server, namespace: "" }
        : { context: target.context },
      {
        onSuccess: (started) => {
          openExternal(started.authorizeUrl);
          complete.mutate({ loginId: started.loginId });
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] text-muted-foreground">
        Sign in on the cluster&apos;s own page, with whatever it asks for there, and faws picks up
        the result.
      </p>
      {waiting && start.data ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card/40 px-2.5 py-2 text-[12px]">
          <Spinner className="size-3" />
          <span className="min-w-0 flex-1">Waiting for the browser…</span>
          <a
            href={start.data.authorizeUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              event.preventDefault();
              if (start.data) openExternal(start.data.authorizeUrl);
            }}
            className={`${textActionClass} inline-flex items-center gap-1`}
          >
            Open it again <ExternalLink className="size-3" />
          </a>
        </div>
      ) : null}
      <FormError error={start.error ?? complete.error} />
      <FormActions>
        <Button
          onClick={() => {
            if (waiting && loginId) cancel.mutate({ loginId });
            onCancel();
          }}
        >
          Cancel
        </Button>
        <Button variant="default" disabled={start.isPending || waiting} onClick={begin}>
          {start.isPending ? <Spinner className="size-3" /> : <Globe className="size-3" />}
          {complete.isError ? "Try again" : "Sign in with the browser"}
        </Button>
      </FormActions>
    </div>
  );
}
