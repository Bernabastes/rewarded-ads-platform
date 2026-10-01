import { zodResolver } from '@hookform/resolvers/zod';
import { ErrorCode } from '@rap/shared';
import { motion, useReducedMotion } from 'framer-motion';
import { Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { applyFieldErrors, describeError, isApiError } from '@/lib/api/errors';
import { useAuth } from '@/lib/auth/use-auth';
import { APP_NAME, BRAND_NAME, BRAND_NAME_AM } from '@/lib/brand';
import { env } from '@/lib/env';
import { useTheme } from '@/lib/hooks/use-theme';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { BrandMark } from '@/components/layout/sidebar';

const schema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});
type FormValues = z.infer<typeof schema>;

const LOGOUT_MESSAGES = {
  manual: null,
  expired: 'Your session expired. Please sign in again.',
  revoked: 'Your session was signed out for security reasons. Please sign in again.',
} as const;

export function LoginPage() {
  const { login, completeMfaLogin, state } = useAuth();
  const { resolved } = useTheme();
  const reduce = useReducedMotion();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [mfa, setMfa] = useState<{ mfaToken: string; email: string } | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const res = await login(values.email, values.password);
      if ('mfaRequired' in res && res.mfaRequired) {
        setMfa({ mfaToken: res.mfaToken, email: values.email });
        setCode('');
        setCodeError(null);
      }
    } catch (err) {
      if (isApiError(err) && err.code === ErrorCode.VALIDATION_ERROR) {
        const applied = applyFieldErrors(err, (name, e) => form.setError(name as keyof FormValues, e), ['email', 'password']);
        if (applied.length) return;
      }
      if (isApiError(err) && err.code === ErrorCode.INVALID_CREDENTIALS) {
        form.setError('password', { type: 'server', message: 'Incorrect email or password.' });
        return;
      }
      if (isApiError(err) && err.code === ErrorCode.ACCOUNT_LOCKED) {
        const retry = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
        setFormError(`Too many failed attempts - this account is temporarily locked${retry ? ` (try again in about ${Math.ceil(retry / 60)} min)` : ''}.`);
        return;
      }
      if (isApiError(err) && err.code === ErrorCode.LOGIN_RATE_LIMITED) {
        setFormError('Too many sign-in attempts. Please wait a few minutes and try again.');
        return;
      }
      setFormError(describeError(err));
    }
  });

  const onVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfa) return;
    if (!/^\d{6}$/.test(code)) {
      setCodeError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setCodeError(null);
    setVerifying(true);
    try {
      await completeMfaLogin(mfa.mfaToken, code);
    } catch (err) {
      if (isApiError(err) && err.code === ErrorCode.MFA_CODE_INVALID) {
        setCodeError('That code is not valid. Wait for the next code and try again.');
      } else if (isApiError(err) && err.code === ErrorCode.MFA_TOKEN_INVALID) {
        setMfa(null);
        setFormError('The verification challenge expired. Please sign in again.');
      } else if (isApiError(err) && err.code === ErrorCode.ACCOUNT_LOCKED) {
        setMfa(null);
        setFormError('Too many failed attempts - this account is temporarily locked.');
      } else {
        setCodeError(describeError(err));
      }
    } finally {
      setVerifying(false);
    }
  };

  const notice = state.lastLogoutReason ? LOGOUT_MESSAGES[state.lastLogoutReason] : null;

  return (
    <div className="grid min-h-screen bg-bg lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-forest-900 text-forest-50 lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(78,152,119,0.45),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(217,98,43,0.35),transparent_50%)]" />
        <div className="relative flex h-full flex-col justify-between p-10">
          <div className="flex items-center gap-3">
            <BrandMark className="size-9 bg-forest-50 text-forest-800" />
            <div>
              <div className="text-sm font-semibold">{APP_NAME}</div>
              <div className="text-xs text-forest-200">
                {BRAND_NAME_AM} · {BRAND_NAME} rewarded advertising
              </div>
            </div>
          </div>
          <motion.div initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
            <h1 className="max-w-md text-3xl leading-tight font-semibold tracking-tight">Every birr and every coin, accounted for.</h1>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-forest-100/80">
              Review creatives against the banned-topics list, hold risky withdrawals for dual approval, resolve fraud flags and keep the ledger
              honest - with an audit trail behind every decision.
            </p>
            <ul className="mt-6 grid gap-2 text-xs text-forest-100/90">
              {['Role-based access, enforced by the API', 'Two-admin approval for large payouts & manual credits', 'Append-only ledger; balances derived, never edited'].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <ShieldCheck className="size-3.5 text-terracotta-300" /> {t}
                </li>
              ))}
            </ul>
          </motion.div>
          <div className="text-2xs text-forest-200/70">
            API · <span className="font-mono">{env.apiBaseUrl}</span>
          </div>
        </div>
      </aside>

      <main className="flex items-center justify-center p-6">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-sm"
        >
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <BrandMark />
            <div className="text-sm font-semibold">{APP_NAME}</div>
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-fg">{mfa ? 'Two-factor verification' : 'Sign in'}</h2>
          <p className="mt-1 text-sm text-fg-muted">
            {mfa ? (
              <>
                Enter the 6-digit code from your authenticator app for <span className="font-medium text-fg">{mfa.email}</span>.
              </>
            ) : (
              'Internal console for the platform team. Use your admin email.'
            )}
          </p>

          {notice ? (
            <div role="status" className="mt-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-fg">
              {notice}
            </div>
          ) : null}
          {formError ? (
            <div role="alert" className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-fg">
              {formError}
            </div>
          ) : null}

          {mfa ? (
            <form onSubmit={onVerifyCode} noValidate className="mt-6 space-y-4" data-testid="mfa-form">
              <Field label="Verification code" required error={codeError ?? undefined}>
                {(id, describedBy) => (
                  <Input
                    id={id}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={6}
                    placeholder="123456"
                    className="font-mono text-lg tracking-[0.4em]"
                    aria-describedby={describedBy}
                    invalid={Boolean(codeError)}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  />
                )}
              </Field>
              <Button type="submit" size="lg" className="w-full" loading={verifying}>
                <ShieldCheck className="size-4" /> Verify & sign in
              </Button>
              <Button type="button" variant="link" size="sm" className="w-full" onClick={() => setMfa(null)} disabled={verifying}>
                Back to password
              </Button>
            </form>
          ) : (
          <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
            <Field label="Email" required error={form.formState.errors.email?.message}>
              {(id, describedBy) => (
                <Input id={id} type="email" autoComplete="username" autoFocus placeholder="you@rap.et" aria-describedby={describedBy} invalid={Boolean(form.formState.errors.email)} {...form.register('email')} />
              )}
            </Field>
            <Field label="Password" required error={form.formState.errors.password?.message}>
              {(id, describedBy) => (
                <div className="relative">
                  <Input
                    id={id}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="pr-9"
                    aria-describedby={describedBy}
                    invalid={Boolean(form.formState.errors.password)}
                    {...form.register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-fg-subtle hover:text-fg"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              )}
            </Field>
            <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
              <LockKeyhole className="size-4" /> Sign in
            </Button>
          </form>
          )}

          <p className="mt-6 text-2xs leading-relaxed text-fg-subtle">
            Sessions use short-lived access tokens with rotating refresh tokens. Every action you take is written to the audit log. Theme:{' '}
            {resolved}.
          </p>
        </motion.div>
      </main>
    </div>
  );
}
