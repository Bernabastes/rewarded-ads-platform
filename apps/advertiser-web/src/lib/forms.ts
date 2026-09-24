import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import { describeApiError, mapValidationErrors } from './api/errors';

/**
 * Push `VALIDATION_ERROR` details into react-hook-form fields; anything that does not map to a field becomes a
 * root error. Returns true when at least one field error was set (so callers can skip the toast).
 */
export function applyApiErrorToForm<T extends FieldValues>(
  error: unknown,
  form: UseFormReturn<T>,
  fieldMap: Record<string, Path<T>> = {},
): boolean {
  const known = Object.keys(form.getValues());
  const { fieldErrors, formErrors } = mapValidationErrors(error, known, fieldMap);
  const fields = Object.entries(fieldErrors);
  fields.forEach(([field, message], index) => {
    form.setError(field as Path<T>, { type: 'server', message }, { shouldFocus: index === 0 });
  });
  if (formErrors.length > 0) {
    form.setError('root.server', { type: 'server', message: formErrors.join(' ') });
  }
  return fields.length > 0 || formErrors.length > 0;
}

/** Standard mutation error handler: map to the form when possible, otherwise toast on the error code. */
export function handleFormError<T extends FieldValues>(
  error: unknown,
  form: UseFormReturn<T>,
  fieldMap?: Record<string, Path<T>>,
) {
  if (applyApiErrorToForm(error, form, fieldMap)) return;
  const { title, description } = describeApiError(error);
  form.setError('root.server', { type: 'server', message: description ? `${title}. ${description}` : title });
}

export function toastApiError(error: unknown) {
  const { title, description } = describeApiError(error);
  toast.error(title, { description });
}
