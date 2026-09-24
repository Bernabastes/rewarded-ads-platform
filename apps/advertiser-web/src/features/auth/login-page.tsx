import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/primitives';
import { handleFormError } from '@/lib/forms';
import { AuthLayout } from './auth-layout';
import { useAuth } from './auth-provider';

const schema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
  remember: z.boolean(),
});

type LoginValues = z.infer<typeof schema>;

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<LoginValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', remember: true },
  });
  const { register, handleSubmit, formState, setValue, control, clearErrors } = form;
  const remember = useWatch({ control, name: 'remember' });

  const onSubmit = handleSubmit(async (values) => {
    clearErrors('root.server');
    try {
      const profile = await login({ email: values.email.trim(), password: values.password }, values.remember);
      toast.success(`Welcome back, ${profile.businessName}`);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (error) {
      handleFormError(error, form, { email: 'email' });
    }
  });

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Manage campaigns, creatives and billing for your business."
      footer={
        <p>
          New here?{' '}
          <Link to="/register" className="font-medium text-primary underline-offset-4 hover:underline">
            Create a business account
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5" aria-label="Sign in form">
        {formState.errors.root?.server && <Alert tone="danger">{formState.errors.root.server.message}</Alert>}
        <Field label="Work email" error={formState.errors.email?.message} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@business.et"
              aria-describedby={describedBy}
              invalid={invalid}
              autoFocus
              {...register('email')}
            />
          )}
        </Field>
        <Field label="Password" error={formState.errors.password?.message} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Your password"
              aria-describedby={describedBy}
              invalid={invalid}
              trailing={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              }
              {...register('password')}
            />
          )}
        </Field>
        <Field label="Keep me signed in on this device" inline>
          {({ id }) => (
            <Checkbox id={id} checked={remember} onCheckedChange={(checked) => setValue('remember', checked === true)} />
          )}
        </Field>
        <Button type="submit" size="lg" loading={formState.isSubmitting} className="mt-1 w-full">
          Sign in
        </Button>
        <p className="text-center text-xs text-fg-subtle">
          Forgot your password? Password reset is not self-service yet — email support and we will help you within a working day.
        </p>
      </form>
    </AuthLayout>
  );
}
