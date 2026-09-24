import type { OfferCompletionResult } from '@rap/shared';
import { OfferCompletionStatus } from '@rap/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInRight } from 'react-native-reanimated';

import { offersApi } from '@/api/endpoints/offers';
import { useSurvey } from '@/api/queries/ads';
import { invalidateMoney, queryKeys } from '@/api/queryClient';
import { Badge, Chip } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CoinEarnedAnimation } from '@/components/ui/CoinEarnedAnimation';
import { CoinMark } from '@/components/ui/CoinMark';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Screen } from '@/components/ui/Screen';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { Tappable } from '@/components/ui/Tappable';
import { Text } from '@/components/ui/Text';
import { buildSurveyPayload, isAnswered, type AnswerValue } from '@/features/offers/survey';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errorMessage';
import { formatCoinsAsEtb, formatEtb } from '@/utils/format';

export default function SurveyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const { colors, spacing, radii } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const survey = useSurvey(id);

  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OfferCompletionResult | null>(null);

  const questions = useMemo(() => survey.data?.questions ?? [], [survey.data]);
  const question = questions[index];
  const current = question ? answers[question.id] : undefined;
  const canAdvance = question ? !question.required || isAnswered(question, current) : false;
  const isLast = index === questions.length - 1;

  const setAnswer = (value: AnswerValue) => question && setAnswers((prev) => ({ ...prev, [question.id]: value }));

  const submit = async () => {
    if (!survey.data) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = buildSurveyPayload(questions, answers);
      const res = await offersApi.completeSurvey(survey.data.id, { answers: payload });
      setResult(res);
      void invalidateMoney(queryClient);
      void queryClient.invalidateQueries({ queryKey: ['offers'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.offerCompletions });
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  if (survey.isPending) {
    return (
      <Screen header={{ title: t('offers.types.survey') }}>
        <SkeletonGroup>
          <Skeleton height={28} width="70%" />
          <Skeleton height={60} />
          <Skeleton height={120} radius={16} />
        </SkeletonGroup>
      </Screen>
    );
  }
  if (survey.isError || !survey.data) {
    return (
      <Screen header={{ title: t('offers.types.survey') }}>
        <EmptyState illustration="error" title={t('common.somethingWrong')} body={errorMessage(survey.error, t)} action={{ title: t('common.retry'), onPress: () => void survey.refetch(), icon: 'refresh' }} />
      </Screen>
    );
  }
  const data = survey.data;

  if (result) {
    const credited = result.status === OfferCompletionStatus.valid && result.coinReward > 0;
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']} header={{ hideBack: true }} testID="survey-result" footer={<Button title={t('common.done')} onPress={() => router.replace('/(tabs)/offers')} size="lg" />}>
        <View style={styles.center}>
          {credited ? (
            <CoinEarnedAnimation coins={result.coinReward} etbLabel={formatCoinsAsEtb(result.coinReward, 100, t, language)} />
          ) : (
            <Badge label={t(`offers.status.${result.status}`)} tone="info" size="md" />
          )}
          <Text variant="h1" weight="bold" align="center" style={{ marginTop: spacing.xl }} accessibilityRole="header">
            {t('offers.survey.resultTitle')}
          </Text>
          <Text variant="body" tone="secondary" align="center" style={{ marginTop: spacing.sm }}>
            {credited ? t('offers.survey.resultBody') : t('offers.survey.resultPending')}
          </Text>
        </View>
      </Screen>
    );
  }

  if (!started) {
    const done = data.completionStatus !== null;
    return (
      <Screen
        header={{ title: t('offers.types.survey') }}
        testID="survey-intro"
        footer={<Button title={t('offers.survey.start')} onPress={() => setStarted(true)} size="lg" icon="play" disabled={done || questions.length === 0} testID="survey-start" />}
      >
        <View style={{ gap: spacing.lg }}>
          <View>
            <Text variant="caption" tone="muted" weight="medium">
              {data.advertiserName}
            </Text>
            <Text variant="h1" weight="bold" accessibilityRole="header">
              {data.title}
            </Text>
          </View>
          {data.description ? (
            <Text variant="body" tone="secondary">
              {data.description}
            </Text>
          ) : null}
          <View style={styles.statsRow}>
            <Card style={{ flex: 1 }} padding={spacing.md}>
              <View style={styles.inline}>
                <CoinMark size={20} />
                <Text variant="h3" weight="bold" tone="primary">
                  {t('money.coins', { count: data.rewardCoins })}
                </Text>
              </View>
              <Text variant="caption" tone="secondary">
                {formatEtb(data.rewardEtb, t, language)}
              </Text>
            </Card>
            <Card style={{ flex: 1 }} padding={spacing.md}>
              <View style={styles.inline}>
                <Icon name="clock" size={20} color={colors.text} />
                <Text variant="h3" weight="bold">
                  {t('offers.estimated', { minutes: data.estimatedMinutes })}
                </Text>
              </View>
              <Text variant="caption" tone="secondary">
                {t('offers.survey.progress', { current: 0, total: questions.length })}
              </Text>
            </Card>
          </View>
          {done && data.completionStatus ? <Badge label={t(`offers.status.${data.completionStatus}`)} tone="neutral" size="md" /> : null}
        </View>
      </Screen>
    );
  }

  const prompt = language === 'am' && question?.promptAm ? question.promptAm : question?.prompt;

  return (
    <Screen
      header={{
        title: t('offers.survey.progress', { current: index + 1, total: questions.length }),
        onBack: () => {
          if (index > 0) {
            setIndex(index - 1);
            return true;
          }
          setStarted(false);
          return true;
        },
      }}
      keyboardAvoiding
      testID={`survey-question-${index}`}
      footer={
        <Button
          title={isLast ? (submitting ? t('offers.survey.submitting') : t('offers.survey.submit')) : t('common.next')}
          onPress={() => (isLast ? void submit() : setIndex(index + 1))}
          disabled={!canAdvance}
          loading={submitting}
          size="lg"
          testID="survey-next"
        />
      }
    >
      <ProgressBar progress={(index + 1) / Math.max(1, questions.length)} style={{ marginBottom: spacing.xl }} />
      {question ? (
        <Animated.View key={question.id} entering={FadeInRight.duration(250)} style={{ gap: spacing.lg }}>
          <View style={{ gap: 6 }}>
            {question.required ? <Badge label={t('offers.survey.required')} tone="neutral" /> : null}
            <Text variant="h2" weight="bold" accessibilityRole="header">
              {prompt}
            </Text>
            {question.type === 'multi_choice' ? (
              <Text variant="caption" tone="muted">
                {t('offers.survey.multiHint')}
              </Text>
            ) : null}
            {question.type === 'rating' ? (
              <Text variant="caption" tone="muted">
                {t('offers.survey.ratingHint')}
              </Text>
            ) : null}
          </View>

          {question.type === 'single_choice' || question.type === 'multi_choice' ? (
            <View style={{ gap: spacing.sm }}>
              {(question.options ?? []).map((option, i) => {
                const key = String(i);
                const selected = question.type === 'single_choice' ? current === key : Array.isArray(current) && current.includes(key);
                return (
                  <Tappable
                    key={key}
                    onPress={() => {
                      if (question.type === 'single_choice') setAnswer(key);
                      else {
                        const list = Array.isArray(current) ? current : [];
                        setAnswer(selected ? list.filter((v) => v !== key) : [...list, key]);
                      }
                    }}
                    accessibilityRole={question.type === 'single_choice' ? 'radio' : 'checkbox'}
                    accessibilityState={{ selected, checked: selected }}
                    testID={`survey-option-${i}`}
                    style={[
                      styles.option,
                      { borderRadius: radii.md, backgroundColor: selected ? colors.primarySoft : colors.surface, borderColor: selected ? colors.primary : colors.border },
                    ]}
                  >
                    <Text variant="body" weight={selected ? 'semibold' : 'regular'} style={{ flex: 1 }}>
                      {option}
                    </Text>
                    {selected ? <Icon name="check" color={colors.primary} /> : null}
                  </Tappable>
                );
              })}
            </View>
          ) : null}

          {question.type === 'rating' ? (
            <View style={styles.ratingRow}>
              {Array.from({ length: (question.max ?? 5) - (question.min ?? 1) + 1 }, (_, i) => (question.min ?? 1) + i).map((n) => (
                <Chip key={n} label={String(n)} selected={current === n} onPress={() => setAnswer(n)} accessibilityLabel={String(n)} style={styles.ratingChip} />
              ))}
            </View>
          ) : null}

          {question.type === 'text' ? (
            <Input
              value={typeof current === 'string' ? current : ''}
              onChangeText={(value) => setAnswer(value)}
              placeholder={t('offers.survey.textPlaceholder')}
              multiline
              numberOfLines={4}
              style={{ minHeight: 110, textAlignVertical: 'top' }}
              testID="survey-text"
            />
          ) : null}

          {error ? (
            <Text variant="bodySmall" tone="danger" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
        </Animated.View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', paddingTop: 24 },
  statsRow: { flexDirection: 'row', gap: 12 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1.5, minHeight: 52 },
  ratingRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ratingChip: { minWidth: 48, justifyContent: 'center' },
});
