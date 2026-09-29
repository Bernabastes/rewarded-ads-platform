import type { AdminDeletionRequestItem } from '@rap/shared';

/** Why "Execute" is not available (null = allowed). Mirrors the server's DELETION_BLOCKED_PENDING_WITHDRAWALS gate. */
export function deletionExecuteBlock(row: Pick<AdminDeletionRequestItem, 'status' | 'pendingWithdrawals'>): string | null {
  if (row.status !== 'pending') return `This request is already ${row.status}.`;
  if (row.pendingWithdrawals > 0)
    return `${row.pendingWithdrawals} withdrawal${row.pendingWithdrawals === 1 ? ' is' : 's are'} still in flight. Decide ${row.pendingWithdrawals === 1 ? 'it' : 'them'} in the finance queue first - anonymising now would orphan the payout.`;
  return null;
}

/** A pending request whose scheduled date has passed will be executed by the nightly job. */
export function deletionIsDue(row: Pick<AdminDeletionRequestItem, 'status' | 'scheduledFor'>, now = Date.now()): boolean {
  return row.status === 'pending' && new Date(row.scheduledFor).getTime() <= now;
}
