import { zodResolver } from '@hookform/resolvers/zod';
import type { CampaignDetail, TargetActionType } from '@rap/shared';
import { ArrowRight } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/primitives';
import { TARGET_ACTION_META } from '@/features/campaigns/campaign-card';
import { handleFormError } from '@/lib/forms';
import { cn } from '@/lib/utils/cn';
import { todayIsoDate } from '@/lib/utils/format';
import { detailsSchema, type DetailsValues } from './schemas';

export function detailsFromCampaign(campaign: CampaignDetail): DetailsValues {
  return {
    title: campaign.title,
    description: campaign.description ?? '',
    targetActionType: campaign.targetActionType,
    startDate: campaign.startDate ?? '',
    endDate: campaign.endDate ?? '',
    attentionCheckEnabled: campaign.attentionCheckEnabled,
  };
}

export const DEFAULT_DETAILS: DetailsValues = {
  title: '',
  description: '',
  targetActionType: 'video_view',
  startDate: '',
  endDate: '',
  attentionCheckEnabled: true,
};

export function DetailsStep({
  defaultValues,
  onSubmit,
  submitLabel = 'Continue to budget',
  saving,
}: {
  defaultValues: DetailsValues;
  onSubmit: (values: DetailsValues) => Promise<void> | void;
  submitLabel?: string;
  saving?: boolean;
}) {
  const form = useForm<DetailsValues>({ resolver: zodResolver(detailsSchema), defaultValues, mode: 'onTouched' });
  const { register, handleSubmit, formState, control, setValue } = form;
  const targetActionType = useWatch({ control, name: 'targetActionType' });
  const attentionCheckEnabled = useWatch({ control, name: 'attentionCheckEnabled' });
  const startDate = useWatch({ control, name: 'startDate' });

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(values);
    } catch (error) {
      handleFormError(error, form);
    }
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6" aria-label="Campaign details">
      {formState.errors.root?.server && <Alert tone="danger">{formState.errors.root.server.message}</Alert>}

      <Field label="Campaign title" required error={formState.errors.title?.message} hint="Shown to viewers above the ad — Amharic titles are welcome.">
        {({ id, describedBy, invalid }) => (
          <Input id={id} placeholder="e.g. ቡና ታይም — Morning Roast launch" aria-describedby={describedBy} invalid={invalid} autoFocus {...register('title')} />
        )}
      </Field>

      <Field label="Description" error={formState.errors.description?.message} hint="Optional. Helps our reviewers understand the campaign.">
        {({ id, describedBy, invalid }) => (
          <Textarea id={id} rows={3} placeholder="What is the offer and who is it for?" aria-describedby={describedBy} invalid={invalid} {...register('description')} />
        )}
      </Field>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium text-fg">
          Target action <span className="text-danger">*</span>
        </legend>
        <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Target action">
          {(Object.keys(TARGET_ACTION_META) as TargetActionType[]).map((type) => {
            const meta = TARGET_ACTION_META[type];
            const selected = targetActionType === type;
            return (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setValue('targetActionType', type, { shouldDirty: true })}
                className={cn(
                  'flex min-h-11 flex-col gap-2 rounded-md border p-4 text-left transition-[border-color,box-shadow,background-color]',
                  selected ? 'border-primary bg-primary-soft shadow-soft ring-1 ring-primary/30' : 'border-border bg-surface hover:border-border-strong',
                )}
              >
                <meta.icon className={cn('size-5', selected ? 'text-primary' : 'text-fg-subtle')} />
                <span className="font-medium text-fg">{meta.label}</span>
                <span className="text-xs leading-relaxed text-fg-muted">{meta.description}</span>
              </button>
            );
          })}
        </div>
        {targetActionType !== 'video_view' && (
          <Alert tone="info">
            Survey and app-install offers are configured with our team after review. You can still attach an optional video or image so
            viewers know what to expect.
          </Alert>
        )}
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Start date" error={formState.errors.startDate?.message} hint="Leave empty to start as soon as approved.">
          {({ id, describedBy, invalid }) => (
            <Input id={id} type="date" min={todayIsoDate()} aria-describedby={describedBy} invalid={invalid} {...register('startDate')} />
          )}
        </Field>
        <Field label="End date" error={formState.errors.endDate?.message} hint="Leave empty to run until the budget is spent.">
          {({ id, describedBy, invalid }) => (
            <Input id={id} type="date" min={startDate || todayIsoDate()} aria-describedby={describedBy} invalid={invalid} {...register('endDate')} />
          )}
        </Field>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-md border border-border p-4">
        <div>
          <p id="attention-label" className="font-medium text-fg">
            Attention check after each ad
          </p>
          <p id="attention-hint" className="mt-1 text-sm text-fg-muted">
            Viewers answer one quick question about your ad before earning their reward. Recommended — it filters out passive
            viewing and you only pay for completions that pass.
          </p>
        </div>
        <Switch
          checked={attentionCheckEnabled}
          onCheckedChange={(checked) => setValue('attentionCheckEnabled', checked, { shouldDirty: true })}
          aria-labelledby="attention-label"
          aria-describedby="attention-hint"
        />
      </div>

      <div className="flex justify-end">
        <Button type="submit" size="lg" loading={saving || formState.isSubmitting} trailingIcon={<ArrowRight className="size-4" />}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
