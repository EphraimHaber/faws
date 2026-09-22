import { kubeSshFormSchema } from "@faws/contracts";

import { Form, FormActions, SubmitButton, TextField, useZodForm } from "~/components/form";
import { Dialog } from "~/components/Dialog";
import { Button } from "~/components/ui/button";

/** The login RHEL-family cloud images ship with; Ubuntu's is `ubuntu`, Fedora's `fedora`. */
const DEFAULT_GUEST_USER = "cloud-user";

/**
 * Asks which guest login `virtctl ssh` should use before it connects.
 *
 * Nothing in the cluster reports the right one: it is a property of the image
 * inside the machine, not of the VirtualMachine object. So it is asked for,
 * with the common default filled in, rather than guessed at silently - a wrong
 * guess fails as an authentication error that says nothing about the login.
 */
export function VmSshDialog({
  context,
  namespace,
  vm,
  onConnect,
  onClose,
}: {
  context: string;
  namespace: string;
  vm: string;
  onConnect: (user: string) => void;
  onClose: () => void;
}) {
  const form = useZodForm(kubeSshFormSchema, {
    defaultValues: { context, namespace, vm, user: DEFAULT_GUEST_USER },
  });

  return (
    <Dialog id="vm-ssh" title={`SSH into ${vm}`} onClose={onClose}>
      <Form
        form={form}
        onSubmit={(values) => {
          onConnect(values.user);
          onClose();
        }}
      >
        <p className="truncate font-mono text-[11.5px] text-muted-foreground">
          {context} / {namespace} / {vm}
        </p>

        <TextField
          name="user"
          label="Guest login"
          hint="The account inside the machine's image, not a Kubernetes user."
          mono
          autoFocus
        />

        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton>Connect</SubmitButton>
        </FormActions>
      </Form>
    </Dialog>
  );
}
