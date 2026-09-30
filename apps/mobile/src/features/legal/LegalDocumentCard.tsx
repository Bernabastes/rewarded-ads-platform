import type { LegalDocumentItem, UserConsentState } from '@rap/shared';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Tappable } from '@/components/ui/Tappable';
import { Text } from '@/components/ui/Text';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDate } from '@/utils/format';

import { parseLegalMarkdown, type LegalBlock } from './consent';

const PREVIEW_BLOCKS = 4;

export interface LegalDocumentCardProps {
  document: LegalDocumentItem;
  /** The user's stored consent for this kind (Profile → Legal shows the accepted version). */
  consent?: UserConsentState | null;
  /** Acceptance checkbox (consent screen). Omit for read-only rendering. */
  accepted?: boolean;
  onToggleAccepted?: (next: boolean) => void;
  disabled?: boolean;
  testID?: string;
}

function LegalBlockView({ block }: { block: LegalBlock }) {
  const { spacing } = useTheme();
  switch (block.type) {
    case 'heading':
      return (
        <Text variant={block.level === 1 ? 'h3' : 'body'} weight="semibold" style={{ marginTop: spacing.sm }} accessibilityRole="header">
          {block.text}
        </Text>
      );
    case 'bullet':
      return (
        <View style={styles.bullet}>
          <Text variant="bodySmall" tone="secondary">
            {'•'}
          </Text>
          <Text variant="bodySmall" tone="secondary" style={{ flex: 1 }}>
            {block.text}
          </Text>
        </View>
      );
    default:
      return (
        <Text variant="bodySmall" tone="secondary">
          {block.text}
        </Text>
      );
  }
}

/** One legal document: title, version, the markdown body (collapsible) and a link to the hosted text. */
export function LegalDocumentCard({ document, consent, accepted, onToggleAccepted, disabled, testID }: LegalDocumentCardProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { colors, spacing, radii } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const blocks = useMemo(() => parseLegalMarkdown(document.contentMarkdown), [document.contentMarkdown]);
  // The first block usually repeats the title as a heading; skip it to avoid saying it twice.
  const bodyBlocks = blocks[0]?.type === 'heading' ? blocks.slice(1) : blocks;
  const visible = expanded ? bodyBlocks : bodyBlocks.slice(0, PREVIEW_BLOCKS);
  const canExpand = bodyBlocks.length > PREVIEW_BLOCKS;
  const selectable = onToggleAccepted !== undefined;

  return (
    <Card testID={testID ?? `legal-${document.kind}`}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="h3" weight="semibold" accessibilityRole="header">
            {document.title || t(`legal.kinds.${document.kind}`)}
          </Text>
          <Text variant="caption" tone="muted">
            {t('legal.version', { version: document.version })}
            {' · '}
            {t('legal.published', { date: formatDate(document.publishedAt, language) })}
          </Text>
        </View>
        {consent ? (
          consent.outdated || !consent.acceptedVersion ? (
            <Badge label={t('legal.notAccepted')} tone="warning" icon="alert" />
          ) : (
            <Badge label={t('legal.acceptedVersion', { version: consent.acceptedVersion })} tone="success" icon="circleCheck" />
          )
        ) : null}
      </View>

      <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
        {visible.length ? (
          visible.map((block, index) => <LegalBlockView key={index} block={block} />)
        ) : (
          <Text variant="bodySmall" tone="secondary">
            {t('legal.noInlineText')}
          </Text>
        )}
        {canExpand ? (
          <Button
            title={expanded ? t('legal.showLess') : t('legal.readMore')}
            onPress={() => setExpanded((v) => !v)}
            variant="ghost"
            size="sm"
            fullWidth={false}
            icon={expanded ? 'chevronDown' : 'chevronRight'}
          />
        ) : null}
        {document.url ? (
          <Tappable
            onPress={() => void Linking.openURL(document.url as string)}
            accessibilityRole="link"
            accessibilityLabel={t('legal.openFull')}
            accessibilityHint={t('a11y.openLink')}
            style={styles.link}
          >
            <Icon name="external" size={16} color={colors.primary} />
            <Text variant="bodySmall" weight="medium" tone="primary">
              {t('legal.openFull')}
            </Text>
          </Tappable>
        ) : null}
      </View>

      {consent?.acceptedAt && !consent.outdated ? (
        <Text variant="caption" tone="muted" style={{ marginTop: spacing.md }}>
          {t('legal.acceptedOn', { date: formatDate(consent.acceptedAt, language) })}
        </Text>
      ) : null}

      {selectable ? (
        <Tappable
          onPress={() => onToggleAccepted?.(!accepted)}
          disabled={disabled}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: Boolean(accepted), disabled }}
          accessibilityLabel={t('consent.acceptOne', { title: document.title })}
          testID={`consent-accept-${document.kind}`}
          style={[
            styles.checkRow,
            {
              marginTop: spacing.lg,
              padding: spacing.md,
              borderRadius: radii.md,
              backgroundColor: accepted ? colors.primarySoft : colors.surfaceMuted,
              borderColor: accepted ? colors.primary : colors.border,
            },
          ]}
        >
          <View
            style={[
              styles.checkbox,
              {
                borderColor: accepted ? colors.primary : colors.borderStrong,
                backgroundColor: accepted ? colors.primary : 'transparent',
                borderRadius: radii.sm,
              },
            ]}
          >
            {accepted ? <Icon name="check" size={14} color={colors.textOnPrimary} strokeWidth={3} /> : null}
          </View>
          <Text variant="bodySmall" weight="medium" style={{ flex: 1 }}>
            {t('consent.acceptOne', { title: document.title })}
          </Text>
        </Tappable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  bullet: { flexDirection: 'row', gap: 8 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 32 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5 },
  checkbox: { width: 22, height: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
