import { kubeServerFormSchema } from "@faws/contracts";
import * as React from "react";

import { Form, FormActions, SubmitButton, TextField, useZodForm } from "~/components/form";
import { Dialog } from "~/components/Dialog";
import { Button } from "~/components/ui/button";
import { setKubeContext } from "~/stores/scope";

import { ClusterProbe } from "./ClusterProbe";
import { LoginForm } from "./LoginForm";

/**
 * Adding a cluster by its API URL: look at what is there, settle any
 * certificate question, then log in. The login lands in the person's own
 * kubeconfig, under the names `oc login` uses, and the pages switch to it.
 */
export function AddClusterDialog({ onClose }: { onClose: () => void }) {
  const [server, setServer] = React.useState<string | null>(null);
  const form = useZodForm(kubeServerFormSchema, { defaultValues: { server: "" } });

  return (
    <Dialog id="kube-add-cluster" title="Add a cluster" onClose={onClose}>
      {server === null ? (
        <Form form={form} onSubmit={(values) => setServer(values.server)}>
          <TextField
            name="server"
            label="API server URL"
            hint="The address oc login takes, such as https://api.ocp.example.com:6443."
            placeholder="https://api.ocp.example.com:6443"
            autoFocus
            mono
          />
          <FormActions>
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton variant="default">Continue</SubmitButton>
          </FormActions>
        </Form>
      ) : (
        <div className="flex flex-col gap-3">
          <ClusterProbe server={server}>
            {(probe) => (
              <LoginForm
                target={{ kind: "new", server: probe.server }}
                probe={probe}
                onDone={(result) => {
                  setKubeContext(result.context);
                  onClose();
                }}
                onCancel={onClose}
              />
            )}
          </ClusterProbe>
          <button
            type="button"
            onClick={() => setServer(null)}
            className="self-start text-[11.5px] text-muted-foreground hover:text-foreground"
          >
            another server
          </button>
        </div>
      )}
    </Dialog>
  );
}
