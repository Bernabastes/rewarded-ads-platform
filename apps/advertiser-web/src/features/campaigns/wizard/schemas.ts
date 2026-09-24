import { TargetActionType } from '@rap/shared';
import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker')
  .or(z.literal(''));

export const detailsSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(3, 'Give the campaign a title of at least 3 characters')
      .max(160, 'Keep the title under 160 characters'),
    description: z.string().trim().max(2000, 'Keep the description under 2000 characters'),
    targetActionType: z.enum([
      TargetActionType.video_view,
      TargetActionType.survey,
      TargetActionType.app_install,
    ]),
    startDate: isoDate,
    endDate: isoDate,
    attentionCheckEnabled: z.boolean(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    path: ['endDate'],
    message: 'The end date must be on or after the start date',
  });

export type DetailsValues = z.infer<typeof detailsSchema>;

export const MIN_BUDGET_ETB = 100;
export const MIN_COST_PER_ACTION_ETB = 0.5;
export const MAX_BUDGET_ETB = 10_000_000;
export const MAX_COST_PER_ACTION_ETB = 10_000;

export const budgetSchema = z
  .object({
    budgetEtb: z
      .number({ error: 'Enter a total budget' })
      .min(MIN_BUDGET_ETB, `The minimum campaign budget is ETB ${MIN_BUDGET_ETB}`)
      .max(MAX_BUDGET_ETB, 'That budget is above the platform maximum'),
    costPerActionEtb: z
      .number({ error: 'Enter a cost per action' })
      .min(
        MIN_COST_PER_ACTION_ETB,
        `The minimum cost per action is ETB ${MIN_COST_PER_ACTION_ETB.toFixed(2)}`,
      )
      .max(MAX_COST_PER_ACTION_ETB, 'That cost per action is above the platform maximum')
      .refine((v) => Math.round(v * 100) === v * 100, 'Use at most two decimals'),
  })
  .refine((v) => v.costPerActionEtb <= v.budgetEtb, {
    path: ['costPerActionEtb'],
    message: 'The cost per action cannot exceed the total budget',
  });

export type BudgetValues = z.infer<typeof budgetSchema>;

export const attentionQuestionSchema = z
  .object({
    prompt: z.string().trim().min(3, 'Write the question (at least 3 characters)').max(300),
    promptAm: z.string().trim().max(300),
    options: z.array(z.string().trim().max(120)).min(2).max(4),
    correctIndex: z.number().int().min(0).max(3),
  })
  .superRefine((q, ctx) => {
    q.options.forEach((option, index) => {
      if (!option)
        ctx.addIssue({
          code: 'custom',
          path: ['options', index],
          message: 'Fill in this option or remove it',
        });
    });
    if (!q.options[q.correctIndex]) {
      ctx.addIssue({ code: 'custom', path: ['correctIndex'], message: 'Choose which option is correct' });
    }
  });

export const creativeSchema = z.object({
  title: z.string().trim().min(2, 'Name this creative (at least 2 characters)').max(160),
  description: z.string().trim().max(1000),
  durationSeconds: z
    .number({ error: 'Enter the duration in seconds' })
    .int('Whole seconds only')
    .min(5, 'Creatives must run for at least 5 seconds')
    .max(120, 'Creatives can run for at most 120 seconds'),
  attentionQuestion: attentionQuestionSchema.nullable(),
});

export type CreativeValues = z.infer<typeof creativeSchema>;

/** sessionStorage-backed scratchpad so steps entered before the draft exists survive a reload. */
const DRAFT_KEY = 'gize.wizard.new';

export interface WizardScratch {
  details?: DetailsValues;
  budget?: BudgetValues;
}

export const wizardScratch = {
  read(): WizardScratch {
    try {
      const raw = window.sessionStorage.getItem(DRAFT_KEY);
      return raw ? (JSON.parse(raw) as WizardScratch) : {};
    } catch {
      return {};
    }
  },
  write(patch: WizardScratch) {
    try {
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...wizardScratch.read(), ...patch }));
    } catch {
      // ignore
    }
  },
  clear() {
    try {
      window.sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
  },
};
