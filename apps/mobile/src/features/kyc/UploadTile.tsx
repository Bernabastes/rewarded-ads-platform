import type { KycUploadKind } from '@rap/shared';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';

import { cameraAvailable, type PickSource } from './upload';
import type { UploadState } from './validation';

const KIND_ICONS: Record<KycUploadKind, IconName> = { document_front: 'clipboard', document_back: 'clipboard', selfie: 'user' };

export interface UploadTileProps {
  kind: KycUploadKind;
  state: UploadState;
  onPick(source: PickSource): void;
  onRetry(): void;
  disabled?: boolean;
}

/** One document slot: empty (pick), uploading (spinner), uploaded (thumbnail + replace) or error (retry). */
export function UploadTile({ kind, state, onPick, onRetry, disabled }: UploadTileProps) {
  const { t } = useTranslation();
  const { colors, spacing, radii } = useTheme();
  const uploaded = state.status === 'uploaded';
  const file = 'file' in state ? state.file : null;

  return (
    <View
      style={[
        styles.tile,
        {
          borderColor: state.status === 'error' ? colors.danger : uploaded ? colors.success : colors.border,
          backgroundColor: colors.surface,
          borderRadius: radii.lg,
          padding: spacing.md,
        },
      ]}
      testID={`kyc-upload-${kind}`}
      accessible
      accessibilityLabel={`${t(`kyc.uploads.${kind}.title`)}. ${t(`kyc.uploads.status.${state.status}`)}`}
    >
      <View style={styles.header}>
        <View style={[styles.preview, { backgroundColor: colors.surfaceMuted, borderRadius: radii.md }]}>
          {file && file.mimeType.startsWith('image/') ? (
            <Image source={{ uri: file.uri }} style={styles.previewImage} contentFit="cover" accessibilityIgnoresInvertColors />
          ) : (
            <Icon name={KIND_ICONS[kind]} size={22} color={colors.textSecondary} />
          )}
          {state.status === 'uploading' ? (
            <View style={[styles.overlay, { backgroundColor: colors.overlay, borderRadius: radii.md }]}>
              <ActivityIndicator color={colors.textOnPrimary} />
            </View>
          ) : null}
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="body" weight="semibold">
            {t(`kyc.uploads.${kind}.title`)}
          </Text>
          <Text variant="caption" tone="muted">
            {t(`kyc.uploads.${kind}.hint`)}
          </Text>
          {uploaded ? <Badge label={t('kyc.uploads.status.uploaded')} tone="success" icon="circleCheck" /> : null}
          {state.status === 'uploading' ? <Badge label={t('kyc.uploads.status.uploading')} tone="info" icon="refresh" /> : null}
          {state.status === 'error' ? <Badge label={t('kyc.uploads.status.error')} tone="danger" icon="alert" /> : null}
        </View>
      </View>
      {state.status === 'error' ? (
        <Text variant="caption" tone="danger" style={{ marginTop: spacing.sm }} accessibilityLiveRegion="polite">
          {state.message}
        </Text>
      ) : null}
      <View style={[styles.actions, { marginTop: spacing.md }]}>
        {state.status === 'error' && state.file ? (
          <Button title={t('common.retry')} onPress={onRetry} size="sm" variant="secondary" icon="refresh" fullWidth={false} disabled={disabled} testID={`kyc-upload-${kind}-retry`} />
        ) : null}
        {cameraAvailable() ? (
          <Button
            title={uploaded ? t('kyc.uploads.retake') : t('kyc.uploads.takePhoto')}
            onPress={() => onPick('camera')}
            size="sm"
            variant={uploaded ? 'ghost' : 'secondary'}
            icon="video"
            fullWidth={false}
            disabled={disabled || state.status === 'uploading'}
            testID={`kyc-upload-${kind}-camera`}
          />
        ) : null}
        <Button
          title={uploaded ? t('kyc.uploads.replace') : t('kyc.uploads.choose')}
          onPress={() => onPick('library')}
          size="sm"
          variant={uploaded || cameraAvailable() ? 'ghost' : 'secondary'}
          icon="download"
          fullWidth={false}
          disabled={disabled || state.status === 'uploading'}
          testID={`kyc-upload-${kind}-choose`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { borderWidth: 1.5 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  preview: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  previewImage: { width: '100%', height: '100%' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
