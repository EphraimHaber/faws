/**
 * Form building blocks.
 *
 * A form is a schema from `@faws/contracts` passed to `useZodForm`, a `Form`
 * around the fields, and the field components below. Nothing outside this
 * directory should reach for `react-hook-form` directly, so that validation,
 * error presentation and keyboard behaviour are decided once.
 */
export { CheckboxField } from "./CheckboxField.tsx";
export { confirmMatches, confirmProgress } from "./confirm.ts";
export { ConfirmTextField } from "./ConfirmTextField.tsx";
export { Form, FormActions, FormSection } from "./Form.tsx";
export { FormError } from "./FormError.tsx";
export { controlClass, FormField, type FieldControlProps } from "./FormField.tsx";
export {
  KeyValueField,
  pairsToRecord,
  recordToPairs,
  type KeyValuePair,
} from "./KeyValueField.tsx";
export { NumberField } from "./NumberField.tsx";
export { RadioGroupField, type RadioOption } from "./RadioGroupField.tsx";
export { SelectField, type SelectOption } from "./SelectField.tsx";
export { SubmitButton } from "./SubmitButton.tsx";
export { TextAreaField } from "./TextAreaField.tsx";
export { TextField } from "./TextField.tsx";
export { useZodForm, type ZodForm } from "./useZodForm.ts";
