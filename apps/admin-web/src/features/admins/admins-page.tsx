import { zodResolver } from '@hookform/resolvers/zod';
import { type AdminAccountItem, type AdminRole, ErrorCode } from '@rap/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { KeyRound, ShieldCheck, UserCog, UserPlus, UserRoundX, UserRoundCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { adminsApi } from '@/lib/api/endpoints';
import { describeError, isApiError } from '@/lib/api/errors';
import { ALL_ROLES, ROLE_DESCRIPTION, ROLE_LABEL } from '@/lib/auth/rbac';
import { useAuth } from '@/lib/auth/use-auth';
import { formatDateTime, formatRelative } from '@/lib/utils/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, ReasonDialog } from '@/components/ui/confirm';
import { DataTable } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/feedback';
import { Field, Input, NativeSelect } from '@/components/ui/input';
import { CopyButton, PageHeader } from '@/components/ui/page';
import { Tooltip } from '@/components/ui/primitives';

const QUERY_KEY = ['admins'] as const;

const createSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  fullName: z.string().trim().min(2, 'Enter the full name'),
  role: z.enum(['super_admin', 'ad_reviewer', 'support', 'finance']),
});
type CreateValues = z.infer<typeof createSchema>;

/** Phase 5 (#5): super_admin management of admin accounts (replaces editing the seed / database). */
export function AdminsPage() {
  const { admin: me } = useAuth();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: QUERY_KEY, queryFn: adminsApi.list, refetchInterval: 60_000 });
  const [createOpen, setCreateOpen] = useState(false);
  const [credential, setCredential] = useState<{ email: string; temporaryPassword: string; title: string } | null>(null);
  const [roleTarget, setRoleTarget] = useState<AdminAccountItem | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminAccountItem | null>(null);
  const [activeTarget, setActiveTarget] = useState<AdminAccountItem | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: ['audit'] });
  };

  const create = useMutation({
    mutationFn: (v: CreateValues) => adminsApi.create(v),
    onSuccess: (res) => {
      setCreateOpen(false);
      setCredential({ email: res.admin.email, temporaryPassword: res.temporaryPassword, title: 'Admin account created' });
      invalidate();
    },
  });
  const reset = useMutation({
    mutationFn: (id: string) => adminsApi.resetPassword(id),
    onSuccess: (res) => {
      setResetTarget(null);
      setCredential({ email: res.admin.email, temporaryPassword: res.temporaryPassword, title: 'Password reset' });
      invalidate();
    },
    onError: (err) => toast.error('Could not reset password', { description: describeError(err) }),
  });
  const setActive = useMutation({
    mutationFn: ({ id, active, reason }: { id: string; active: boolean; reason: string }) => adminsApi.setActive(id, active, reason),
    onSuccess: (res) => {
      toast.success(res.active ? 'Account reactivated' : 'Account deactivated', { description: res.active ? undefined : 'Every session of this admin was signed out.' });
      setActiveTarget(null);
      invalidate();
    },
    onError: (err) => toast.error('Could not update account', { description: describeError(err) }),
  });

  const columns = useMemo<ColumnDef<AdminAccountItem, unknown>[]>(
    () => [
      {
        id: 'admin',
        header: 'Admin',
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 truncate font-medium">
              {row.original.fullName}
              {row.original.id === me?.id ? (
                <Badge tone="primary" size="sm">
                  you
                </Badge>
              ) : null}
            </div>
            <div className="truncate font-mono text-2xs text-fg-subtle">{row.original.email}</div>
          </div>
        ),
      },
      {
        id: 'role',
        header: 'Role',
        cell: ({ row }) => <Badge tone={row.original.role === 'super_admin' ? 'accent' : 'neutral'}>{ROLE_LABEL[row.original.role]}</Badge>,
        size: 130,
      },
      {
        id: 'security',
        header: 'Security',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.mfaEnabled ? (
              <Badge tone="success" size="sm" className="gap-1">
                <ShieldCheck className="size-2.5" /> MFA
              </Badge>
            ) : (
              <Badge tone="neutral" size="sm">
                no MFA
              </Badge>
            )}
            {row.original.mustChangePassword ? (
              <Tooltip content="Signed in with a temporary password that has not been changed yet">
                <span>
                  <Badge tone="warning" size="sm">
                    temp password
                  </Badge>
                </span>
              </Tooltip>
            ) : null}
            {!row.original.active ? (
              <Badge tone="danger" size="sm">
                deactivated
              </Badge>
            ) : null}
          </div>
        ),
      },
      {
        id: 'lastLogin',
        header: 'Last sign-in',
        cell: ({ row }) =>
          row.original.lastLoginAt ? (
            <Tooltip content={formatDateTime(row.original.lastLoginAt)}>
              <span className="whitespace-nowrap text-fg-muted">{formatRelative(row.original.lastLoginAt)}</span>
            </Tooltip>
          ) : (
            <span className="text-fg-subtle">never</span>
          ),
        size: 120,
      },
      {
        id: 'actions',
        header: '',
        meta: { align: 'right' },
        cell: ({ row }) => {
          const a = row.original;
          const self = a.id === me?.id;
          return (
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="xs" onClick={() => setRoleTarget(a)} disabled={!a.active} data-testid={`role-${a.email}`}>
                <UserCog className="size-3.5" /> Role
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setResetTarget(a)} disabled={!a.active} data-testid={`reset-${a.email}`}>
                <KeyRound className="size-3.5" /> Reset password
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setActiveTarget(a)} disabled={self} data-testid={`active-${a.email}`}>
                {a.active ? <UserRoundX className="size-3.5 text-danger" /> : <UserRoundCheck className="size-3.5 text-success" />} {a.active ? 'Deactivate' : 'Reactivate'}
              </Button>
            </div>
          );
        },
      },
    ],
    [me?.id],
  );

  return (
    <div className="space-y-3">
      <PageHeader
        title="Admin accounts"
        description="Create console accounts with a one-time temporary password, change roles (sessions are revoked immediately) and reset passwords. Everything is audited."
        actions={
          <Button onClick={() => setCreateOpen(true)} data-testid="create-admin">
            <UserPlus className="size-4" /> New admin
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={list.data?.data}
        getRowId={(r) => r.id}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyState={<EmptyState compact title="No admin accounts" description="Create the first account with “New admin”." />}
        aria-label="Admin accounts"
      />

      <CreateAdminDialog open={createOpen} onOpenChange={setCreateOpen} onSubmit={(v) => create.mutateAsync(v)} />

      <Dialog
        open={Boolean(credential)}
        onOpenChange={(o) => !o && setCredential(null)}
        title={credential?.title ?? ''}
        description="Share this temporary password with the admin over a secure channel. It is shown only once and must be changed at first sign-in."
        footer={
          <Button onClick={() => setCredential(null)} data-testid="credential-done">
            Done
          </Button>
        }
      >
        {credential ? (
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-2xs font-semibold tracking-wider text-fg-subtle uppercase">Email</div>
              <div className="font-mono">{credential.email}</div>
            </div>
            <div>
              <div className="text-2xs font-semibold tracking-wider text-fg-subtle uppercase">Temporary password</div>
              <div className="flex items-center gap-2">
                <code className="rounded border bg-sunken px-2 py-1 font-mono text-sm select-all" data-testid="temporary-password">
                  {credential.temporaryPassword}
                </code>
                <CopyButton value={credential.temporaryPassword} label="Copy" />
              </div>
            </div>
          </div>
        ) : null}
      </Dialog>

      {roleTarget ? <ChangeRoleDialog target={roleTarget} onClose={() => setRoleTarget(null)} onChanged={invalidate} /> : null}

      <ConfirmDialog
        open={Boolean(resetTarget)}
        onOpenChange={(o) => !o && setResetTarget(null)}
        title="Reset password"
        description={`${resetTarget?.email} gets a new temporary password and every active session is signed out. They must change it at next sign-in.`}
        confirmLabel="Reset & show temporary password"
        loading={reset.isPending}
        onConfirm={() => {
          if (resetTarget) reset.mutate(resetTarget.id);
        }}
      />

      <ReasonDialog
        open={Boolean(activeTarget)}
        onOpenChange={(o) => !o && setActiveTarget(null)}
        destructive={Boolean(activeTarget?.active)}
        title={activeTarget?.active ? 'Deactivate admin account' : 'Reactivate admin account'}
        description={
          activeTarget?.active
            ? `${activeTarget.email} loses access immediately (all sessions revoked). The audit history stays intact.`
            : `${activeTarget?.email} can sign in again with their existing password.`
        }
        confirmLabel={activeTarget?.active ? 'Deactivate' : 'Reactivate'}
        loading={setActive.isPending}
        onConfirm={(reason) => {
          if (activeTarget) setActive.mutate({ id: activeTarget.id, active: !activeTarget.active, reason });
        }}
      />
    </div>
  );
}

function CreateAdminDialog({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (o: boolean) => void; onSubmit: (v: CreateValues) => Promise<unknown> }) {
  const form = useForm<CreateValues>({ resolver: zodResolver(createSchema), defaultValues: { email: '', fullName: '', role: 'ad_reviewer' } });
  const role = form.watch('role');
  const submit = form.handleSubmit(async (values) => {
    try {
      await onSubmit(values);
      form.reset();
    } catch (err) {
      if (isApiError(err) && err.code === ErrorCode.EMAIL_ALREADY_REGISTERED) {
        form.setError('email', { type: 'server', message: 'An admin with this email already exists.' });
        return;
      }
      toast.error('Could not create admin', { description: describeError(err) });
    }
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New admin account"
      description="The account starts with a temporary password that must be changed at first sign-in."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={form.formState.isSubmitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={form.formState.isSubmitting} data-testid="create-admin-submit">
            Create account
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="grid gap-3">
        <Field label="Full name" required error={form.formState.errors.fullName?.message}>
          {(id, describedBy) => <Input id={id} autoFocus aria-describedby={describedBy} invalid={Boolean(form.formState.errors.fullName)} {...form.register('fullName')} />}
        </Field>
        <Field label="Email" required error={form.formState.errors.email?.message}>
          {(id, describedBy) => <Input id={id} type="email" placeholder="name@rap.et" aria-describedby={describedBy} invalid={Boolean(form.formState.errors.email)} {...form.register('email')} />}
        </Field>
        <Field label="Role" required hint={ROLE_DESCRIPTION[role as AdminRole]}>
          {(id) => (
            <NativeSelect id={id} {...form.register('role')}>
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </form>
    </Dialog>
  );
}

function ChangeRoleDialog({ target, onClose, onChanged }: { target: AdminAccountItem; onClose: () => void; onChanged: () => void }) {
  const [role, setRole] = useState<AdminRole>(target.role);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: () => adminsApi.changeRole(target.id, { role, reason }),
    onSuccess: () => {
      toast.success('Role changed', { description: `${target.email} is now ${ROLE_LABEL[role]}. Their sessions were signed out.` });
      onChanged();
      onClose();
    },
    onError: (err) => {
      if (isApiError(err) && err.code === ErrorCode.LAST_SUPER_ADMIN) {
        setError('This would leave the platform without an active super admin.');
        return;
      }
      toast.error('Could not change role', { description: describeError(err) });
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Change role"
      description={`${target.fullName} · ${target.email}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={change.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (reason.trim().length < 5) {
                setError('Give a reason (at least 5 characters) - it is written to the audit log.');
                return;
              }
              if (role === target.role) {
                setError('Pick a different role.');
                return;
              }
              setError(null);
              change.mutate();
            }}
            loading={change.isPending}
            data-testid="change-role-submit"
          >
            Change role & sign them out
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="New role" required hint={ROLE_DESCRIPTION[role]}>
          {(id) => (
            <NativeSelect id={id} value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label="Reason" required error={error ?? undefined}>
          {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Moved to the finance team" invalid={Boolean(error)} />}
        </Field>
      </div>
    </Dialog>
  );
}
