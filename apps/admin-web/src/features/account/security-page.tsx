import { zodResolver } from '@hookform/resolvers/zod';
import { ErrorCode } from '@rap/shared';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { accountApi } from '@/lib/api/endpoints';
import { describeError, isApiError } from '@/lib/api/errors';
import { ROLE_LABEL } from '@/lib/auth/rbac';
import { useAuth } from '@/lib/auth/use-auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { CopyButton, PageHeader } from '@/components/ui/page';

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).+$/;

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z.string().min(8, 'At least 8 characters').regex(PASSWORD_RULE, 'Use at least one letter and one digit'),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: 'Choose a different password' });
type PasswordValues = z.infer<typeof passwordSchema>;

const CODE_RULE = /^\d{6}$/;

/**
 * Phase 5 (#5): self-service security. Also the landing page for admins in a pending state - a temporary
 * password (`mustChangePassword`) or missing required TOTP (`mfaSetupRequired`) blocks every other route.
 */
export function SecurityPage() {
  const { admin, refreshProfile } = useAuth();
  if (!admin) return null;
  const pending = admin.mustChangePassword || admin.mfaSetupRequired;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="My security" description={`${admin.email} · ${ROLE_LABEL[admin.role]}`} />

      {pending ? (
        <div role="alert" className="rounded-md border border-warning/50 bg-warning/10 px-4 py-3 text-sm text-fg" data-testid="pending-security-banner">
          <div className="font-medium">Finish setting up your account to continue</div>
          <ul className="mt-1 list-disc pl-5 text-xs text-fg-muted">
            {admin.mustChangePassword ? <li>Replace the temporary password you were given.</li> : null}
            {admin.mfaSetupRequired ? <li>Enable two-factor authentication - it is mandatory for the {ROLE_LABEL[admin.role]} role.</li> : null}
          </ul>
        </div>
      ) : null}

      <ChangePasswordCard mustChange={admin.mustChangePassword} />
      <MfaCard enabled={admin.mfaEnabled} required={admin.mfaSetupRequired} onChanged={refreshProfile} />
    </div>
  );
}

function ChangePasswordCard({ mustChange }: { mustChange: boolean }) {
  const { logout } = useAuth();
  const form = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const change = useMutation({
    mutationFn: (v: PasswordValues) => accountApi.changePassword(v.currentPassword, v.newPassword),
    onSuccess: async () => {
      toast.success('Password changed', { description: 'Every session was signed out for security. Please sign in with your new password.' });
      await logout('manual');
    },
    onError: (err) => {
      if (isApiError(err) && err.code === ErrorCode.INVALID_CREDENTIALS) {
        form.setError('currentPassword', { type: 'server', message: 'Current password is incorrect.' });
        return;
      }
      toast.error('Could not change password', { description: describeError(err) });
    },
  });

  return (
    <Card data-testid="change-password-card">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <KeyRound className="size-4 text-fg-muted" /> Password
          </span>
        }
        description={mustChange ? 'You signed in with a temporary password - choose your own now.' : 'Changing it signs out every session, including this one.'}
      />
      <CardBody>
        <form onSubmit={form.handleSubmit((v) => change.mutate(v))} noValidate className="grid gap-3 sm:max-w-sm">
          <Field label={mustChange ? 'Temporary password' : 'Current password'} required error={form.formState.errors.currentPassword?.message}>
            {(id, describedBy) => (
              <Input id={id} type="password" autoComplete="current-password" aria-describedby={describedBy} invalid={Boolean(form.formState.errors.currentPassword)} {...form.register('currentPassword')} />
            )}
          </Field>
          <Field label="New password" required hint="At least 8 characters with a letter and a digit." error={form.formState.errors.newPassword?.message}>
            {(id, describedBy) => (
              <Input id={id} type="password" autoComplete="new-password" aria-describedby={describedBy} invalid={Boolean(form.formState.errors.newPassword)} {...form.register('newPassword')} />
            )}
          </Field>
          <Field label="Confirm new password" required error={form.formState.errors.confirm?.message}>
            {(id, describedBy) => (
              <Input id={id} type="password" autoComplete="new-password" aria-describedby={describedBy} invalid={Boolean(form.formState.errors.confirm)} {...form.register('confirm')} />
            )}
          </Field>
          <div>
            <Button type="submit" loading={change.isPending} data-testid="change-password-submit">
              Change password
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function MfaCard({ enabled, required, onChanged }: { enabled: boolean; required: boolean; onChanged: () => Promise<void> }) {
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  // Phase 5b New-7: enrolment re-authenticates - the password is asked once before setup and sent again on enable.
  const [startOpen, setStartOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: (pw: string) => accountApi.mfaSetup(pw),
    onSuccess: (res) => {
      setSetup(res);
      setStartOpen(false);
      setPasswordError(null);
      setCode('');
      setCodeError(null);
    },
    onError: (err) => {
      if (isApiError(err) && err.code === ErrorCode.INVALID_CREDENTIALS) {
        setPasswordError('Password is incorrect.');
        return;
      }
      if (isApiError(err) && err.code === ErrorCode.ACCOUNT_LOCKED) {
        setPasswordError('Too many failed attempts - this account is temporarily locked.');
        return;
      }
      toast.error('Could not start setup', { description: describeError(err) });
    },
  });
  const enable = useMutation({
    mutationFn: (c: string) => accountApi.mfaEnable(c, password),
    onSuccess: async () => {
      toast.success('Two-factor authentication enabled', { description: 'From now on sign-in asks for a code from your authenticator app.' });
      setSetup(null);
      setCode('');
      setPassword('');
      await onChanged();
    },
    onError: (err) => {
      if (isApiError(err) && err.code === ErrorCode.MFA_CODE_INVALID) {
        setCodeError('That code is not valid. Check the clock on your phone and try the next code.');
        return;
      }
      if (isApiError(err) && err.code === ErrorCode.INVALID_CREDENTIALS) {
        setCodeError('Your password changed since setup started. Cancel and start again.');
        return;
      }
      if (isApiError(err) && err.code === ErrorCode.ACCOUNT_LOCKED) {
        setCodeError('Too many wrong codes - this account is temporarily locked. Try again later.');
        return;
      }
      toast.error('Could not enable', { description: describeError(err) });
    },
  });
  const disable = useMutation({
    mutationFn: (v: { code: string; password: string }) => accountApi.mfaDisable(v.code, v.password),
    onSuccess: async () => {
      toast.success('Two-factor authentication disabled');
      setDisableOpen(false);
      setCode('');
      setDisablePassword('');
      await onChanged();
    },
    onError: (err) => {
      if (isApiError(err) && err.code === ErrorCode.MFA_CODE_INVALID) {
        setCodeError('That code is not valid.');
        return;
      }
      if (isApiError(err) && err.code === ErrorCode.INVALID_CREDENTIALS) {
        setCodeError('Password is incorrect.');
        return;
      }
      toast.error('Could not disable', { description: describeError(err) });
    },
  });

  const submitCode = () => {
    if (!CODE_RULE.test(code)) {
      setCodeError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setCodeError(null);
    enable.mutate(code);
  };

  return (
    <Card data-testid="mfa-card">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Smartphone className="size-4 text-fg-muted" /> Two-factor authentication (TOTP)
            {enabled ? (
              <Badge tone="success" size="sm" className="gap-1">
                <ShieldCheck className="size-2.5" /> enabled
              </Badge>
            ) : (
              <Badge tone={required ? 'warning' : 'neutral'} size="sm">
                {required ? 'required' : 'off'}
              </Badge>
            )}
          </span>
        }
        description="Works with Google Authenticator, Microsoft Authenticator, Aegis, 1Password and any RFC 6238 app."
        actions={
          enabled ? (
            <Button variant="outline" size="sm" onClick={() => setDisableOpen(true)}>
              <ShieldOff className="size-3.5" /> Disable
            </Button>
          ) : !setup ? (
            <Button size="sm" onClick={() => setStartOpen(true)} data-testid="mfa-start">
              <ShieldCheck className="size-3.5" /> Set up
            </Button>
          ) : null
        }
      />
      <Dialog
        open={startOpen}
        onOpenChange={(o) => {
          setStartOpen(o);
          if (!o) setPasswordError(null);
        }}
        title="Confirm your password"
        description="Enrolling an authenticator re-checks your password so a hijacked session cannot add one."
        footer={
          <>
            <Button variant="ghost" onClick={() => setStartOpen(false)} disabled={start.isPending}>
              Cancel
            </Button>
            <Button
              loading={start.isPending}
              onClick={() => {
                if (!password) {
                  setPasswordError('Enter your current password.');
                  return;
                }
                setPasswordError(null);
                start.mutate(password);
              }}
              data-testid="mfa-start-confirm"
            >
              Continue
            </Button>
          </>
        }
      >
        <Field label="Current password" required error={passwordError ?? undefined}>
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              invalid={Boolean(passwordError)}
              data-testid="mfa-password"
            />
          )}
        </Field>
      </Dialog>
      {setup ? (
        <CardBody className="space-y-4" data-testid="mfa-setup">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-fg">
            <li>
              In your authenticator app choose <span className="font-medium">Add account → Enter a setup key</span> and paste this key:
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <code className="rounded border bg-sunken px-2 py-1 font-mono text-sm tracking-widest select-all" data-testid="mfa-secret">
                  {setup.secret.replace(/(.{4})/g, '$1 ').trim()}
                </code>
                <CopyButton value={setup.secret} label="Copy key" />
                <a href={setup.otpauthUri} className="text-xs font-medium text-primary hover:underline">
                  Open in authenticator app
                </a>
              </div>
              <p className="mt-1 text-2xs text-fg-subtle">Account: Gize Admin · time-based · 6 digits · 30 seconds.</p>
            </li>
            <li>
              Enter the code the app shows now:
              <div className="mt-1.5 flex flex-wrap items-start gap-2">
                <div className="w-40">
                  <Input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    maxLength={6}
                    aria-label="Verification code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    invalid={Boolean(codeError)}
                    data-testid="mfa-code"
                  />
                </div>
                <Button onClick={submitCode} loading={enable.isPending} data-testid="mfa-enable">
                  Turn on
                </Button>
                <Button variant="ghost" onClick={() => setSetup(null)} disabled={enable.isPending}>
                  Cancel
                </Button>
              </div>
              {codeError ? (
                <p role="alert" className="mt-1 text-xs text-danger" data-testid="mfa-code-error">
                  {codeError}
                </p>
              ) : null}
            </li>
          </ol>
        </CardBody>
      ) : (
        <CardBody className="text-xs text-fg-muted">
          {enabled
            ? 'Sign-in requires your password and a fresh 6-digit code. Disabling needs both a current code and your password.'
            : required
              ? 'Your role handles money. Set up an authenticator app before continuing.'
              : 'Optional for your role, strongly recommended. Codes are verified server-side and each code is accepted once.'}
        </CardBody>
      )}

      <Dialog
        open={disableOpen}
        onOpenChange={(o) => {
          setDisableOpen(o);
          if (!o) setCodeError(null);
        }}
        title="Disable two-factor authentication"
        description="Confirm with a current code and your password. This is written to the audit log."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDisableOpen(false)} disabled={disable.isPending}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={disable.isPending}
              onClick={() => {
                if (!CODE_RULE.test(code)) {
                  setCodeError('Enter the 6-digit code from your authenticator app.');
                  return;
                }
                disable.mutate({ code, password: disablePassword });
              }}
              data-testid="mfa-disable-confirm"
            >
              Disable
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Field label="Authenticator code" required error={codeError ?? undefined}>
            {(id) => <Input id={id} inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} invalid={Boolean(codeError)} />}
          </Field>
          <Field label="Password" required>
            {(id) => <Input id={id} type="password" autoComplete="current-password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} />}
          </Field>
        </div>
      </Dialog>
    </Card>
  );
}
