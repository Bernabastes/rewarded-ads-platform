import type { SurveyAnswer, SurveyQuestion } from '@rap/shared';

export type AnswerValue = SurveyAnswer['value'];

/** A question counts as answered when it has a non-empty value of the right shape. */
export function isAnswered(question: SurveyQuestion, value: AnswerValue | undefined): boolean {
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return Number.isFinite(value);
}

/** Only answered questions are sent; option answers are option indexes as strings (API contract). */
export function buildSurveyPayload(questions: SurveyQuestion[], answers: Record<string, AnswerValue>): SurveyAnswer[] {
  return questions
    .filter((q) => isAnswered(q, answers[q.id]))
    .map((q) => ({ questionId: q.id, value: answers[q.id] }));
}
