import { zodResolver } from '@hookform/resolvers/zod';
import { ETHIOPIAN_PHONE_REGEX, normalizeEthiopianPhone } from '@rap/shared';
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/primitives';
import { BRAND_NAME } from '@/config/brand';
import { handleFormError } from '@/lib/forms';
import { cn } from '@/lib/utils/cn';
import { AuthLayout } from './auth-layout';
import { useAuth } from './auth-provider';
import { assessPassword } from './password-strength';

const schema = z
  .object({
    businessName: z.string().trim().min(2, 'Enter your registered business name').max(160),
    businessRegistrationNumber: z.string().trim().min(3, 'Enter your business registration number').max(80),
    contactEmail: z.email('Enter a valid email address').max(160),
    contactPhone: z
      .string()
      .trim()
      .refine(
        (v) => ETHIOPIAN_PHONE_REGEX.test(v.replace(/[\s\-()]/g, '')),
        'Enter an Ethiopian mobile number, e.g. 0911 000 000',
      ),
    password: z
      .string()
      .min(8, 'Use at least 8 characters')
      .max(128)
      .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, 'Include at least one letter and one number'),
    confirmPassword: z.string(),
    acceptTerms: z.boolean().refine((v) => v, 'You need to accept the advertiser terms to continue'),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

type RegisterValues = z.infer<typeof schema>;

const STRENGTH_COLORS = ['bg-border', 'bg-danger', 'bg-warning', 'bg-info', 'bg-success'];

export function RegisterPage() {
  const { register: registerAccount } = useAuth();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<RegisterValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      businessName: '',
      businessRegistrationNumber: '',
      contactEmail: '',
      contactPhone: '',
      password: '',
      confirmPassword: '',
      acceptTerms: false,
    },
  });
  const { register, handleSubmit, formState, control, setValue, clearErrors } = form;
  const password = useWatch({ control, name: 'password' });
  const acceptTerms = useWatch({ control, name: 'acceptTerms' });
  const strength = assessPassword(password);

  const onSubmit = handleSubmit(async (values) => {
    clearErrors('root.server');
    try {
      const profile = await registerAccount({
        businessName: values.businessName,
        businessRegistrationNumber: values.businessRegistrationNumber,
        contactEmail: values.contactEmail.trim(),
        contactPhone: normalizeEthiopianPhone(values.contactPhone) ?? values.contactPhone,
        password: values.password,
      });
      toast.success(`Welcome to ${BRAND_NAME}, ${profile.businessName}`, {
        description: 'Your business is now queued for verification.',
      });
      navigate('/', { replace: true });
    } catch (error) {
      handleFormError(error, form);
    }
  });

  return (
    <AuthLayout
      title="Create your business account"
      subtitle="Tell us about your business. We verify every advertiser before campaigns go live, so viewers can trust what they see."
      footer={
        <p>
          Already registered?{' '}
          <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5" aria-label="Registration form">
        {formState.errors.root?.server && <Alert tone="danger">{formState.errors.root.server.message}</Alert>}

        <Field
          label="Business name"
          error={formState.errors.businessName?.message}
          required
          hint="As written on your trade licence — Amharic names render fine."
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              autoComplete="organization"
              placeholder="e.g. Habesha Coffee Roasters PLC"
              aria-describedby={describedBy}
              invalid={invalid}
              autoFocus
              {...register('businessName')}
            />
          )}
        </Field>

        <Field
          label="Business registration number"
          error={formState.errors.businessRegistrationNumber?.message}
          required
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              placeholder="e.g. MT/AA/2/0012345/2015"
              aria-describedby={describedBy}
              invalid={invalid}
              {...register('businessRegistrationNumber')}
            />
          )}
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Contact email" error={formState.errors.contactEmail?.message} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@business.et"
                aria-describedby={describedBy}
                invalid={invalid}
                {...register('contactEmail')}
              />
            )}
          </Field>
          <Field label="Contact phone" error={formState.errors.contactPhone?.message} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="0911 000 000"
                aria-describedby={describedBy}
                invalid={invalid}
                {...register('contactPhone')}
              />
            )}
          </Field>
        </div>

        <Field label="Password" error={formState.errors.password?.message} required>
          {({ id, describedBy, invalid }) => (
            <div className="flex flex-col gap-2">
              <Input
                id={id}
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="At least 8 characters with a number"
                aria-describedby={`${describedBy ?? ''} ${id}-strength`.trim()}
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
              <div id={`${id}-strength`} className="flex flex-col gap-1.5" aria-live="polite">
                <div className="flex gap-1.5" aria-hidden="true">
                  {[1, 2, 3, 4].map((step) => (
                    <span
                      key={step}
                      className={cn(
                        'h-1.5 flex-1 rounded-full transition-colors',
                        step <= strength.score ? STRENGTH_COLORS[strength.score] : 'bg-border',
                      )}
                    />
                  ))}
                </div>
                <p className="text-xs text-fg-subtle">
                  {password ? (
                    <>
                      <span className="font-medium text-fg-muted">{strength.label}.</span>{' '}
                      {strength.suggestions.slice(0, 2).join(' · ')}
                    </>
                  ) : (
                    'Use 8+ characters with letters and numbers.'
                  )}
                </p>
              </div>
            </div>
          )}
        </Field>

        <Field label="Confirm password" error={formState.errors.confirmPassword?.message} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              aria-describedby={describedBy}
              invalid={invalid}
              {...register('confirmPassword')}
            />
          )}
        </Field>

        <Field
          inline
          error={formState.errors.acceptTerms?.message}
          label={
            <span className="text-sm leading-relaxed text-fg-muted">
              I confirm this business is legally registered in Ethiopia and I accept the {BRAND_NAME}{' '}
              advertiser terms, including the ban on alcohol, gambling, political and restricted-medicine
              advertising.
            </span>
          }
        >
          {({ id, invalid }) => (
            <Checkbox
              id={id}
              checked={acceptTerms}
              aria-invalid={invalid || undefined}
              onCheckedChange={(checked) =>
                setValue('acceptTerms', checked === true, { shouldValidate: true })
              }
              className="mt-0.5 self-start"
            />
          )}
        </Field>

        <Button type="submit" size="lg" loading={formState.isSubmitting} className="mt-1 w-full">
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
