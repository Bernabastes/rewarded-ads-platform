import { type CoinAdjustmentItem, CoinAdjustmentStatus, type WithdrawalApprovalItem, WithdrawalStatus } from '@rap/shared';

/* --------------------------- withdrawals --------------------------- */

export interface WithdrawalLike {
  status: WithdrawalStatus;
  requiresDualApproval: boolean;
  approvals: Pick<WithdrawalApprovalItem, 'adminId' | 'decision'>[];
  attempts?: number;
}

export interface WithdrawalApprovalState {
  required: 1 | 2;
  /** Approvals recorded so far (decision === approved). */
  count: number;
  /** The current admin already approved this withdrawal. */
  alreadyApprovedByMe: boolean;
  canApprove: boolean;
  canReject: boolean;
  canRetry: boolean;
  /** Why "Approve" is disabled, when it is. */
  approveBlockedReason: string | null;
}

/** Statuses the API accepts for approve / reject / retry (mirrors withdrawals.service.ts). */
export const APPROVABLE_STATUSES: readonly WithdrawalStatus[] = [WithdrawalStatus.flagged_for_review];
export const REJECTABLE_STATUSES: readonly WithdrawalStatus[] = [WithdrawalStatus.flagged_for_review, WithdrawalStatus.pending];
export const MAX_PAYOUT_ATTEMPTS_DEFAULT = 3;

export function getWithdrawalApprovalState(
  w: WithdrawalLike,
  meId: string | null | undefined,
  maxAttempts = MAX_PAYOUT_ATTEMPTS_DEFAULT,
): WithdrawalApprovalState {
  const approved = w.approvals.filter((a) => a.decision === 'approved');
  const required: 1 | 2 = w.requiresDualApproval ? 2 : 1;
  const alreadyApprovedByMe = Boolean(meId) && w.approvals.some((a) => a.adminId === meId);
  const reviewable = APPROVABLE_STATUSES.includes(w.status);

  let approveBlockedReason: string | null = null;
  if (!reviewable) approveBlockedReason = `Only withdrawals held for review can be approved (status: ${w.status}).`;
  else if (alreadyApprovedByMe)
    approveBlockedReason = w.requiresDualApproval
      ? 'You already provided one of the two approvals. A different finance or super admin must give the second.'
      : 'You already approved this withdrawal.';

  return {
    required,
    count: approved.length,
    alreadyApprovedByMe,
    canApprove: approveBlockedReason === null,
    canReject: REJECTABLE_STATUSES.includes(w.status),
    canRetry: w.status === WithdrawalStatus.failed && (w.attempts ?? 0) < maxAttempts,
    approveBlockedReason,
  };
}

/* ------------------------- coin adjustments ------------------------ */

export interface AdjustmentActionState {
  isPending: boolean;
  isMine: boolean;
  canApprove: boolean;
  canReject: boolean;
  canCancel: boolean;
  approveBlockedReason: string | null;
}

export function getAdjustmentActionState(
  item: Pick<CoinAdjustmentItem, 'status' | 'requestedBy'>,
  meId: string | null | undefined,
): AdjustmentActionState {
  const isPending = item.status === CoinAdjustmentStatus.pending_approval;
  const isMine = Boolean(meId) && item.requestedBy === meId;
  let approveBlockedReason: string | null = null;
  if (!isPending) approveBlockedReason = 'This request has already been decided.';
  else if (isMine) approveBlockedReason = 'You requested this adjustment - a different admin must approve it.';
  return {
    isPending,
    isMine,
    canApprove: approveBlockedReason === null,
    canReject: isPending,
    canCancel: isPending && isMine,
    approveBlockedReason,
  };
}
