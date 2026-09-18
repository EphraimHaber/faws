import {
  DEFAULT_FEATURES,
  DEFAULT_TLS,
  s3ConnectionInputSchema,
  type S3Connection,
  type S3ConnectionInput,
  type S3ConnectionProbe,
} from "@faws/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import * as React from "react";

import {
  CheckboxField,
  Form,
  FormActions,
  FormError,
  FormSection,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
  useZodForm,
} from "~/components/form";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Dialog } from "~/features/s3/components/Dialog";
import { trpc } from "~/lib/trpc";

/**
 * Adding or editing an S3 endpoint.
 *
 * The form holds no stored secret: a saved key comes back only as the fact
 * that it is set, and an empty field means "leave it alone". That is what lets
 * an endpoint be renamed, re-pointed or re-trusted without its credentials
 * passing through a renderer again.
 */
export function ConnectionDialog({
  connection,
  onClose,
}: {
  connection: S3Connection | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [probe, setProbe] = React.useState<S3ConnectionProbe | null>(null);

  const profiles = useQuery({ ...trpc.aws.profiles.queryOptions(), staleTime: 5 * 60_000 });

  const form = useZodForm(s3ConnectionInputSchema, {
    defaultValues: defaultsFor(connection),
  });

  const save = useMutation(
    trpc.s3Connections.save.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries();
        onClose();
      },
    }),
  );

  const test = useMutation(
    trpc.s3Connections.test.mutationOptions({ onSuccess: (result) => setProbe(result) }),
  );

  const credentialMode = form.watch("credentialMode");
  const verify = form.watch("tls.verify");

  /** Testing uses the same values the save would, validated the same way. */
  const runTest = () =>
    void form.handleSubmit((values) => {
      setProbe(null);
      test.mutate(values);
    })();

  const trustPresented = (fingerprint: string) => {
    form.setValue("tls.pinnedSha256", fingerprint, { shouldDirty: true });
    form.setValue("tls.verify", true, { shouldDirty: true });
  };

  return (
    <Dialog
      id="s3-connection"
      title={connection ? `Edit ${connection.name}` : "Add an S3 endpoint"}
      onClose={onClose}
    >
      <Form form={form} onSubmit={(values) => save.mutate(values)}>
        <FormSection title="Endpoint">
          <TextField name="name" label="Name" placeholder="MinIO (lab)" autoFocus />
          <TextField
            name="endpoint"
            label="URL"
            hint="Scheme, host and port, with no path."
            placeholder="https://s3.corp.internal:9000"
            mono
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              name="region"
              label="Signing region"
              hint="Most on prem servers ignore it; us-east-1 is the usual filler."
              mono
            />
            <CheckboxField
              name="forcePathStyle"
              label="Path style addressing"
              hint="Off needs wildcard DNS and a wildcard certificate for the bucket names."
              className="self-end pb-1"
            />
          </div>
        </FormSection>

        <FormSection title="Credentials">
          <SelectField
            name="credentialMode"
            label="Source"
            options={[
              { value: "static", label: "Access key stored here" },
              { value: "aws-profile", label: "An AWS profile" },
              { value: "anonymous", label: "None (public buckets)" },
            ]}
          />

          {credentialMode === "static" ? (
            <>
              <TextField name="accessKeyId" label="Access key id" mono />
              <TextField
                name="secretAccessKey"
                label="Secret access key"
                hint={
                  connection?.secretKeys.includes("secretAccessKey")
                    ? "One is stored. Leave this empty to keep it."
                    : "Stored outside this window and never sent back to it."
                }
                secret
                mono
              />
              <TextField
                name="sessionToken"
                label="Session token"
                hint="Only for temporary credentials."
                secret
                mono
              />
            </>
          ) : null}

          {credentialMode === "aws-profile" ? (
            <SelectField
              name="profile"
              label="Profile"
              placeholder="Pick a profile"
              options={(profiles.data ?? []).map((entry) => ({
                value: entry.name,
                label: entry.name,
              }))}
            />
          ) : null}
        </FormSection>

        <FormSection title="TLS">
          <CheckboxField
            name="tls.verify"
            label="Verify the certificate"
            hint="Off accepts any certificate on this endpoint, including one swapped in by something between you and it."
          />
          {verify ? null : (
            <p className="flex items-start gap-2 rounded-md border border-warning/35 bg-warning/8 px-2.5 py-2 text-[11.5px] text-foreground">
              <ShieldAlert className="mt-px size-3.5 shrink-0 text-warning" strokeWidth={1.7} />
              Nothing is checked against the certificate. Pinning the one this endpoint presents, or
              adding its CA below, gives the same reachability without that.
            </p>
          )}

          <TextField
            name="tls.caPaths.0"
            label="CA certificate path"
            hint="A PEM bundle on this machine, for a CA only this network trusts."
            mono
          />
          <TextAreaField
            name="tls.caPem"
            label="CA certificate"
            hint="Pasted PEM, for a machine where the file is not on disk."
            rows={3}
            mono
          />
          <TextField
            name="tls.servername"
            label="Certificate name"
            hint="The name the certificate is checked against, when the URL reaches it by IP."
            mono
          />
          <TextField
            name="tls.pinnedSha256"
            label="Pinned fingerprint"
            hint="SHA-256, colon separated. Set it and only that certificate is accepted."
            mono
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField name="tls.clientCertPath" label="Client certificate" mono />
            <TextField name="tls.clientKeyPath" label="Client key" mono />
          </div>
          <TextField
            name="clientKeyPassphrase"
            label="Client key passphrase"
            hint={
              connection?.secretKeys.includes("clientKeyPassphrase")
                ? "One is stored. Leave this empty to keep it."
                : "Only if the key file is encrypted."
            }
            secret
            mono
          />
        </FormSection>

        <FormSection title="What this endpoint can do">
          <CheckboxField
            name="features.storageMetrics"
            label="Daily storage metrics"
            hint="Only AWS publishes these; a bucket elsewhere is measured by walking it."
          />
          <CheckboxField
            name="features.presign"
            label="Signed URLs"
            hint="Direct browser transfers. They need the browser itself to reach the endpoint and trust its certificate."
          />
        </FormSection>

        {probe ? <ProbeResult probe={probe} onTrust={trustPresented} /> : null}

        <FormError error={save.error ?? test.error} />

        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="outline" onClick={runTest} disabled={test.isPending}>
            {test.isPending ? "Testing…" : "Test"}
          </Button>
          <SubmitButton pending={save.isPending}>Save</SubmitButton>
        </FormActions>
      </Form>
    </Dialog>
  );
}

/**
 * What the endpoint answered.
 *
 * The certificate is shown whether or not it was accepted, because deciding
 * between adding a CA, pinning this one certificate and turning verification
 * off is a decision that needs the certificate in front of it.
 */
function ProbeResult({
  probe,
  onTrust,
}: {
  probe: S3ConnectionProbe;
  onTrust: (fingerprint: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card/40 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={probe.s3.ok ? "success" : "danger"}>
          {probe.s3.ok ? `${probe.s3.bucketCount ?? 0} buckets` : (probe.s3.code ?? "failed")}
        </Badge>
        {probe.tls ? (
          <Badge tone={probe.tls.trusted ? "success" : "warning"}>
            {probe.tls.trusted ? "certificate trusted" : "certificate not trusted"}
          </Badge>
        ) : null}
        {probe.reachable ? null : <Badge tone="danger">unreachable</Badge>}
      </div>

      {probe.s3.error ? (
        <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
          {probe.s3.error}
        </p>
      ) : null}

      {probe.tls ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[10.5px]">
          <Row label="subject" value={probe.tls.subject} />
          <Row
            label="issuer"
            value={probe.tls.issuer + (probe.tls.selfSigned ? " (self signed)" : "")}
          />
          <Row label="valid" value={`${probe.tls.validFrom} → ${probe.tls.validTo}`} />
          <Row label="sha256" value={probe.tls.fingerprintSha256} />
          {probe.tls.error ? <Row label="refused" value={probe.tls.error} /> : null}
        </dl>
      ) : null}

      {probe.tls && !probe.tls.trusted ? (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onTrust(probe.tls?.fingerprintSha256 ?? "")}
          >
            <ShieldCheck className="size-3" /> Trust this certificate
          </Button>
          <span className="text-[11px] text-muted-foreground">
            Pins this exact certificate; anything else is refused.
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all text-foreground">{value}</dd>
    </>
  );
}

function defaultsFor(connection: S3Connection | null): S3ConnectionInput {
  if (!connection) {
    return {
      name: "",
      endpoint: "",
      region: "us-east-1",
      forcePathStyle: true,
      credentialMode: "static",
      accessKeyId: "",
      secretAccessKey: "",
      tls: { ...DEFAULT_TLS, caPaths: [] },
      features: { ...DEFAULT_FEATURES },
    } as S3ConnectionInput;
  }

  return {
    id: connection.id,
    name: connection.name,
    endpoint: connection.endpoint,
    region: connection.region,
    forcePathStyle: connection.forcePathStyle,
    credentialMode: connection.credentials.mode,
    ...(connection.credentials.mode === "aws-profile"
      ? { profile: connection.credentials.profile }
      : {}),
    ...(connection.credentials.mode === "static"
      ? { accessKeyId: connection.credentials.accessKeyId }
      : {}),
    // Left out rather than blanked: an empty string would clear what is stored.
    tls: { ...connection.tls, caPaths: [...connection.tls.caPaths] },
    features: { ...connection.features },
  } as S3ConnectionInput;
}
