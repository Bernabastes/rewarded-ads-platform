import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, KeyRound, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { BRAND_NAME } from '@/config/brand';
import { useAuth } from '@/features/auth/auth-provider';
import { assessPassword } from '@/features/auth/password-strength';
import { handleFormError } from '@/lib/forms';
import { useChangePassword } from './hooks';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z
      .string()
      .min(8, 'Use at least 8 characters')
      .max(128)
      .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, 'Include at least one letter and one number'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ['newPassword'],
    message: 'Choose a password you have not used before',
  });

type PasswordValues = z.infer<typeof schema>;

/** Password change (`POST /auth/advertiser/change-password`); every session is revoked, so we sign out. */
export function SecurityCard() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const changePassword = useChangePassword();
  const [show, setShow] = useState(false);
  const form = useForm<PasswordValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const { register, handleSubmit, formState, control } = form;
  const strength = assessPassword(useWatch({ control, name: 'newPassword' }));

  const submit = handleSubmit(async (values) => {
    try {
      await changePassword.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      toast.success('Password changed', {
        description: 'Every session was signed out for your security. Sign in again with the new password.',
      });
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      handleFormError(error, form, { password: 'newPassword' });
    }
  });

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" /> Security
          </span>
        }
        description="Changing your password signs out every device, including this one."
      />
      <CardContent className="flex flex-col gap-5">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Change password">
          {formState.errors.root?.server && (
            <Alert tone="danger">{formState.errors.root.server.message}</Alert>
          )}
          <Field label="Current password" required error={formState.errors.currentPassword?.message}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                aria-describedby={describedBy}
                invalid={invalid}
                {...register('currentPassword')}
              />
            )}
          </Field>
          <Field
            label="New password"
            required
            error={formState.errors.newPassword?.message}
            hint={strength.score > 0 ? `${strength.label}. ${strength.suggestions.slice(0, 1).join('')}` : 'At least 8 characters with letters and numbers.'}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                aria-describedby={describedBy}
                invalid={invalid}
                trailing={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? 'Hide passwords' : 'Show passwords'}
                    aria-pressed={show}
                  >
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                }
                {...register('newPassword')}
              />
            )}
          </Field>
          <Field label="Confirm new password" required error={formState.errors.confirmPassword?.message}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                aria-describedby={describedBy}
                invalid={invalid}
                {...register('confirmPassword')}
              />
            )}
          </Field>
          <Button
            type="submit"
            className="self-start"
            loading={changePassword.isPending || formState.isSubmitting}
            leadingIcon={<KeyRound className="size-4" />}
          >
            Change password
          </Button>
        </form>
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-sm text-fg-muted">
            Sessions expire after 15 minutes of inactivity unless you chose “Keep me signed in”.
          </p>
          <Button
            variant="outline"
            className="self-start"
            onClick={() => {
              void logout().then(() => {
                toast.success(`Signed out of ${BRAND_NAME}`);
                navigate('/login', { replace: true });
              });
            }}
            leadingIcon={<LogOut className="size-4" />}
          >
            Sign out of this device
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
