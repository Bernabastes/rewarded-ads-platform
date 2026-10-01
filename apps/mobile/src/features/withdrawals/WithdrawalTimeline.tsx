import type { WithdrawalItem } from '@rap/shared';
import { WithdrawalStatus } from '@rap/shared';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';

export const STATUS_TONES: Record<WithdrawalStatus, BadgeTone> = {
  pending: 'info',
  processing: 'info',
  completed: 'success',
  failed: 'danger',
  flagged_for_review: 'warning',
  needs_manual_review: 'warning',
  rejected: 'danger',
};

export type TimelineStepState = 'done' | 'active' | 'upcoming' | 'failed';
export interface TimelineStep {
  key: 'requested' | 'review' | 'queued' | 'sending' | 'completed' | 'failed' | 'rejected';
  state: TimelineStepState;
}

/**
 * Builds the vertical timeline for a withdrawal. The review step is shown only when the request
 * was (or is) under manual review; terminal failures replace the "completed" step.
 */
export function buildTimeline(item: Pick<WithdrawalItem, 'status' | 'reviewReasons' | 'requiresDualApproval'>): TimelineStep[] {
  const reviewed = item.status === WithdrawalStatus.flagged_for_review || item.reviewReasons.length > 0 || item.requiresDualApproval;
  const steps: TimelineStep[] = [{ key: 'requested', state: 'done' }];
  switch (item.status) {
    case WithdrawalStatus.flagged_for_review:
      steps.push({ key: 'review', state: 'active' }, { key: 'queued', state: 'upcoming' }, { key: 'sending', state: 'upcoming' }, { key: 'completed', state: 'upcoming' });
      break;
    case WithdrawalStatus.pending:
      if (reviewed) steps.push({ key: 'review', state: 'done' });
      steps.push({ key: 'queued', state: 'active' }, { key: 'sending', state: 'upcoming' }, { key: 'completed', state: 'upcoming' });
      break;
    case WithdrawalStatus.processing:
    case WithdrawalStatus.needs_manual_review:
      if (reviewed) steps.push({ key: 'review', state: 'done' });
      steps.push({ key: 'queued', state: 'done' }, { key: 'sending', state: 'active' }, { key: 'completed', state: 'upcoming' });
      break;
    case WithdrawalStatus.completed:
      if (reviewed) steps.push({ key: 'review', state: 'done' });
      steps.push({ key: 'queued', state: 'done' }, { key: 'sending', state: 'done' }, { key: 'completed', state: 'done' });
      break;
    case WithdrawalStatus.failed:
      if (reviewed) steps.push({ key: 'review', state: 'done' });
      steps.push({ key: 'queued', state: 'done' }, { key: 'sending', state: 'done' }, { key: 'failed', state: 'failed' });
      break;
    case WithdrawalStatus.rejected:
      steps.push({ key: 'review', state: 'done' }, { key: 'rejected', state: 'failed' });
      break;
  }
  return steps;
}

export function WithdrawalStatusBadge({ status }: { status: WithdrawalStatus }) {
  const { t } = useTranslation();
  return <Badge label={t(`withdraw.status.${status}`)} tone={STATUS_TONES[status]} size="md" />;
}

export function WithdrawalTimeline({ item }: { item: WithdrawalItem }) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const steps = buildTimeline(item);
  const provider = item.providerName ?? t('withdraw.providerFallback');

  return (
    <View testID="withdrawal-timeline">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const color =
          step.state === 'done' ? colors.success : step.state === 'active' ? colors.primary : step.state === 'failed' ? colors.danger : colors.borderStrong;
        return (
          <View key={step.key} style={styles.row} accessible accessibilityLabel={t(`withdraw.timeline.${step.key}`, { provider })}>
            <View style={styles.rail}>
              <View style={[styles.dot, { backgroundColor: step.state === 'upcoming' ? colors.surface : color, borderColor: color }]}>
                {step.state === 'done' ? <Icon name="check" size={12} color={colors.textOnPrimary} strokeWidth={3} /> : null}
                {step.state === 'failed' ? <Icon name="x" size={12} color={colors.textOnPrimary} strokeWidth={3} /> : null}
                {step.state === 'active' ? <View style={[styles.activeCore, { backgroundColor: colors.textOnPrimary }]} /> : null}
              </View>
              {!isLast ? <View style={[styles.line, { backgroundColor: step.state === 'done' ? colors.success : colors.border }]} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: isLast ? 0 : spacing.lg }}>
              <Text variant="body" weight={step.state === 'active' ? 'semibold' : 'medium'} tone={step.state === 'upcoming' ? 'muted' : 'default'}>
                {t(`withdraw.timeline.${step.key}`, { provider })}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  rail: { width: 24, alignItems: 'center' },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  activeCore: { width: 8, height: 8, borderRadius: 4 },
  line: { flex: 1, width: 2, marginVertical: 2 },
});
