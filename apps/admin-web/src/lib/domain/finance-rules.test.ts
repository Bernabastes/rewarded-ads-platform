import { describe, expect, it } from 'vitest';
import { getAdjustmentActionState, getWithdrawalApprovalState } from './finance-rules';

const ME = 'admin-finance';
const OTHER = 'admin-finance2';

const held = (approvals: Array<{ adminId: string; decision: 'approved' | 'rejected' }>, extra: Partial<Parameters<typeof getWithdrawalApprovalState>[0]> = {}) => ({
  status: 'flagged_for_review' as const,
  requiresDualApproval: true,
  approvals,
  ...extra,
});

describe('dual approval of large withdrawals', () => {
  it('needs two approvals and lets a fresh admin give the first one', () => {
    const st = getWithdrawalApprovalState(held([]), ME);
    expect(st.required).toBe(2);
    expect(st.count).toBe(0);
    expect(st.canApprove).toBe(true);
    expect(st.approveBlockedReason).toBeNull();
  });

  it('DISABLES approve for an admin already listed in approvals[] and explains why', () => {
    const st = getWithdrawalApprovalState(held([{ adminId: ME, decision: 'approved' }]), ME);
    expect(st.count).toBe(1);
    expect(st.alreadyApprovedByMe).toBe(true);
    expect(st.canApprove).toBe(false);
    expect(st.approveBlockedReason).toMatch(/different finance or super admin/);
    expect(st.canReject).toBe(true);
  });

  it('lets a DIFFERENT admin provide the second approval', () => {
    const st = getWithdrawalApprovalState(held([{ adminId: ME, decision: 'approved' }]), OTHER);
    expect(st.count).toBe(1);
    expect(st.alreadyApprovedByMe).toBe(false);
    expect(st.canApprove).toBe(true);
  });

  it('single-approval withdrawals only need one and still block a repeat approver', () => {
    expect(getWithdrawalApprovalState(held([], { requiresDualApproval: false }), ME).required).toBe(1);
    const st = getWithdrawalApprovalState(held([{ adminId: ME, decision: 'approved' }], { requiresDualApproval: false }), ME);
    expect(st.canApprove).toBe(false);
    expect(st.approveBlockedReason).toBe('You already approved this withdrawal.');
  });

  it('only flagged_for_review is approvable; pending is rejectable; failed is retryable up to the attempt cap', () => {
    expect(getWithdrawalApprovalState(held([], { status: 'pending' }), ME).canApprove).toBe(false);
    expect(getWithdrawalApprovalState(held([], { status: 'pending' }), ME).canReject).toBe(true);
    expect(getWithdrawalApprovalState(held([], { status: 'processing' }), ME).canReject).toBe(false);
    expect(getWithdrawalApprovalState(held([], { status: 'failed', attempts: 1 }), ME).canRetry).toBe(true);
    expect(getWithdrawalApprovalState(held([], { status: 'failed', attempts: 3 }), ME).canRetry).toBe(false);
    expect(getWithdrawalApprovalState(held([], { status: 'completed' }), ME).canRetry).toBe(false);
  });

  it('does not count rejections as approvals', () => {
    const st = getWithdrawalApprovalState(held([{ adminId: OTHER, decision: 'rejected' }]), ME);
    expect(st.count).toBe(0);
  });
});

describe('coin adjustment two-step workflow', () => {
  const pending = { status: 'pending_approval' as const, requestedBy: ME };

  it('blocks the requester from approving their own request (but lets them cancel)', () => {
    const st = getAdjustmentActionState(pending, ME);
    expect(st.isMine).toBe(true);
    expect(st.canApprove).toBe(false);
    expect(st.approveBlockedReason).toMatch(/different admin must approve/);
    expect(st.canCancel).toBe(true);
    expect(st.canReject).toBe(true);
  });

  it('lets a different admin approve or reject, but not cancel', () => {
    const st = getAdjustmentActionState(pending, OTHER);
    expect(st.canApprove).toBe(true);
    expect(st.canReject).toBe(true);
    expect(st.canCancel).toBe(false);
  });

  it('offers no actions once the request is decided', () => {
    for (const status of ['executed', 'rejected', 'cancelled'] as const) {
      const st = getAdjustmentActionState({ status, requestedBy: ME }, OTHER);
      expect(st.isPending).toBe(false);
      expect(st.canApprove).toBe(false);
      expect(st.canReject).toBe(false);
      expect(st.canCancel).toBe(false);
    }
  });
});
