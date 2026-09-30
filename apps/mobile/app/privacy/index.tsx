import { DataExportStatus, DeletionRequestStatus, ErrorCode, PLATFORM_DEFAULTS } from '@rap/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';

import { usersApi } from '@/api/endpoints/users';
import { isApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryClient';
import { useDataExports, useDeletionRequest } from '@/api/queries/users';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { toast } from '@/components/ui/Toast';
import { BRAND_NAME } from '@/config';
import { exportDownloadable, formatBytes, isExportInProgress, latestExport } from '@/features/privacy/dataExport';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errorMessage';
import { formatDate, formatDateTime } from '@/utils/format';

/** Profile → Privacy & data: download a copy of my data, request / cancel account deletion. */
export default function PrivacyScreen() {
  const { t } = useTranslation();
  const language = useLanguage();
  const client = useQueryClient();
  const { colors, spacing } = useTheme();

  const exports = useDataExports();
  const deletion = useDeletionRequest();
  const latest = latestExport(exports.data?.data);
  const exporting = isExportInProgress(latest);

  const [requestingExport, setRequestingExport] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reason, setReason] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const requestExport = async () => {
    setRequestingExport(true);
    setExportError(null);
    try {
      await usersApi.requestDataExport();
      toast.info(t('privacy.export.requested'));
    } catch (error) {
      if (!(isApiError(error) && error.code === ErrorCode.DATA_EXPORT_IN_PROGRESS)) setExportError(errorMessage(error, t));
    } finally {
      await client.invalidateQueries({ queryKey: queryKeys.dataExports });
      setRequestingExport(false);
    }
  };

  const requestDeletion = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await usersApi.requestDeletion(reason.trim() ? { reason: reason.trim() } : {});
      setConfirmDelete(false);
      setReason('');
      toast.warning(t('privacy.delete.requested'));
    } catch (error) {
      if (isApiError(error) && error.code === ErrorCode.DELETION_REQUEST_PENDING) setConfirmDelete(false);
      else setDeleteError(errorMessage(error, t));
    } finally {
      await client.invalidateQueries({ queryKey: queryKeys.deletionRequest });
      setDeleting(false);
    }
  };

  const cancelDeletion = async () => {
    setCancelling(true);
    setDeleteError(null);
    try {
      await usersApi.cancelDeletion();
      toast.success(t('privacy.delete.cancelled'));
    } catch (error) {
      // NOT_FOUND / DELETION_REQUEST_NOT_PENDING: there is nothing pending anymore - just refresh.
      if (!(isApiError(error) && (error.statusCode === 404 || error.code === ErrorCode.DELETION_REQUEST_NOT_PENDING))) {
        setDeleteError(errorMessage(error, t));
      }
    } finally {
      await client.invalidateQueries({ queryKey: queryKeys.deletionRequest });
      setCancelling(false);
    }
  };

  const pendingDeletion = deletion.data?.status === DeletionRequestStatus.pending ? deletion.data : null;
  const graceDays = deletion.data?.graceDays ?? PLATFORM_DEFAULTS.ACCOUNT_DELETION_GRACE_DAYS;

  return (
    <Screen header={{ title: t('privacy.title') }} testID="privacy-screen">
      <View style={{ gap: spacing.xl }}>
        <Text variant="body" tone="secondary">
          {t('privacy.intro', { brand: BRAND_NAME })}
        </Text>

        <Card testID="privacy-export">
          <View style={styles.rowBetween}>
            <Text variant="h3" weight="semibold" accessibilityRole="header">
              {t('privacy.export.title')}
            </Text>
            <Icon name="download" size={20} color={colors.primary} />
          </View>
          <Text variant="bodySmall" tone="secondary" style={{ marginTop: spacing.sm }}>
            {t('privacy.export.body')}
          </Text>

          {exports.isPending ? (
            <Skeleton height={44} style={{ marginTop: spacing.md }} />
          ) : latest ? (
            <Card tone="muted" padding={spacing.md} style={{ marginTop: spacing.md }} testID={`privacy-export-${latest.status}`}>
              <View style={styles.rowBetween}>
                <Text variant="bodySmall" weight="medium" style={{ flex: 1 }}>
                  {t('privacy.export.requestedOn', { date: formatDateTime(latest.requestedAt, language) })}
                </Text>
                <Badge
                  label={t(`privacy.export.status.${latest.status}`)}
                  tone={latest.status === DataExportStatus.ready ? 'success' : latest.status === DataExportStatus.failed ? 'danger' : 'info'}
                  icon={latest.status === DataExportStatus.ready ? 'circleCheck' : latest.status === DataExportStatus.failed ? 'alert' : 'hourglass'}
                />
              </View>
              {exporting ? (
                <Text variant="caption" tone="muted" style={{ marginTop: 6 }} accessibilityLiveRegion="polite">
                  {t('privacy.export.preparing')}
                </Text>
              ) : null}
              {latest.status === DataExportStatus.ready ? (
                <Text variant="caption" tone="muted" style={{ marginTop: 6 }}>
                  {formatBytes(latest.sizeBytes)}
                  {latest.expiresAt ? ` · ${t('privacy.export.expires', { date: formatDate(latest.expiresAt, language) })}` : ''}
                </Text>
              ) : null}
              {latest.status === DataExportStatus.failed ? (
                <Text variant="caption" tone="danger" style={{ marginTop: 6 }}>
                  {t('privacy.export.failed')}
                </Text>
              ) : null}
            </Card>
          ) : null}

          <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
            {exportDownloadable(latest) && latest?.downloadUrl ? (
              <Button title={t('privacy.export.download')} onPress={() => void Linking.openURL(latest.downloadUrl as string)} icon="download" testID="privacy-export-download" />
            ) : null}
            <Button
              title={exporting ? t('privacy.export.preparingShort') : latest ? t('privacy.export.requestAgain') : t('privacy.export.request')}
              onPress={() => void requestExport()}
              loading={requestingExport}
              disabled={exporting}
              variant={exportDownloadable(latest) ? 'ghost' : 'secondary'}
              icon="refresh"
              testID="privacy-export-request"
            />
          </View>
          {exportError ? (
            <Text variant="bodySmall" tone="danger" style={{ marginTop: spacing.sm }} accessibilityLiveRegion="polite">
              {exportError}
            </Text>
          ) : null}
        </Card>

        <Card style={{ borderColor: pendingDeletion ? colors.warning : colors.border }} testID="privacy-delete">
          <View style={styles.rowBetween}>
            <Text variant="h3" weight="semibold" accessibilityRole="header">
              {t('privacy.delete.title')}
            </Text>
            <Icon name="alert" size={20} color={pendingDeletion ? colors.warning : colors.danger} />
          </View>
          {deletion.isPending ? (
            <Skeleton height={60} style={{ marginTop: spacing.md }} />
          ) : pendingDeletion ? (
            <View style={{ marginTop: spacing.sm, gap: spacing.sm }} testID="privacy-delete-pending">
              <Badge label={t('privacy.delete.pendingBadge')} tone="warning" icon="hourglass" size="md" />
              <Text variant="bodySmall" tone="secondary">
                {t('privacy.delete.pendingBody', { date: formatDate(pendingDeletion.scheduledFor, language), days: pendingDeletion.graceDays })}
              </Text>
              <Button title={t('privacy.delete.cancel')} onPress={() => void cancelDeletion()} loading={cancelling} variant="secondary" icon="x" testID="privacy-delete-cancel" />
            </View>
          ) : (
            <View style={{ marginTop: spacing.sm, gap: spacing.md }}>
              <Text variant="bodySmall" tone="secondary">
                {t('privacy.delete.body', { days: graceDays })}
              </Text>
              <Button title={t('privacy.delete.cta')} onPress={() => setConfirmDelete(true)} variant="danger" icon="x" testID="privacy-delete-open" />
            </View>
          )}
          {deleteError ? (
            <Text variant="bodySmall" tone="danger" style={{ marginTop: spacing.sm }} accessibilityLiveRegion="polite" testID="privacy-delete-error">
              {deleteError}
            </Text>
          ) : null}
        </Card>
      </View>

      {confirmDelete ? (
        <Modal transparent visible animationType="none" onRequestClose={() => setConfirmDelete(false)} statusBarTranslucent>
          <Animated.View entering={FadeIn.duration(150)} style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setConfirmDelete(false)} accessibilityRole="button" accessibilityLabel={t('common.cancel')} />
            <Animated.View entering={FadeInUp.duration(220)} style={[styles.sheet, { backgroundColor: colors.surfaceElevated, borderRadius: 24, padding: spacing.xxl }]} accessibilityViewIsModal testID="privacy-delete-sheet">
              <Text variant="h2" weight="bold" accessibilityRole="header">
                {t('privacy.delete.confirmTitle')}
              </Text>
              <Text variant="body" tone="secondary" style={{ marginTop: spacing.sm }}>
                {t('privacy.delete.confirmBody', { days: graceDays })}
              </Text>
              <Input
                label={t('privacy.delete.reasonLabel')}
                placeholder={t('privacy.delete.reasonPlaceholder')}
                value={reason}
                onChangeText={setReason}
                multiline
                maxLength={300}
                containerStyle={{ marginTop: spacing.lg }}
                testID="privacy-delete-reason"
              />
              {deleteError ? (
                <Text variant="bodySmall" tone="danger" style={{ marginTop: spacing.sm }} accessibilityLiveRegion="polite">
                  {deleteError}
                </Text>
              ) : null}
              <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
                <Button title={t('privacy.delete.confirmCta')} onPress={() => void requestDeletion()} loading={deleting} variant="danger" testID="privacy-delete-confirm" />
                <Button title={t('common.cancel')} onPress={() => setConfirmDelete(false)} variant="ghost" />
              </View>
            </Animated.View>
          </Animated.View>
        </Modal>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%', maxWidth: 420 },
});
