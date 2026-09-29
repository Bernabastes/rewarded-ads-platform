import { zodResolver } from '@hookform/resolvers/zod';
import { ETHIOPIAN_PHONE_REGEX, normalizeEthiopianPhone, type AdvertiserProfile } from '@rap/shared';
import { Building2, Save } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { DescriptionList } from '@/components/ui/table';
import { SUPPORT_EMAIL } from '@/config/brand';
import { handleFormError } from '@/lib/forms';
import { formatDate } from '@/lib/utils/format';
import { useUpdateAdvertiserProfile } from './hooks';

const schema = z.object({
  businessName: z.string().trim().min(2, 'Enter your registered business name').max(160),
  contactPhone: z
    .string()
    .trim()
    .refine(
      (v) => ETHIOPIAN_PHONE_REGEX.test(v.replace(/[\s\-()]/g, '')),
      'Enter an Ethiopian mobile number, e.g. 0911 000 000',
    ),
});

type ProfileValues = z.infer<typeof schema>;

/** Editable business profile (`PATCH /advertisers/me`); identity fields stay read-only. */
export function ProfileCard({ profile }: { profile: AdvertiserProfile }) {
  const update = useUpdateAdvertiserProfile();
  const form = useForm<ProfileValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { businessName: profile.businessName, contactPhone: profile.contactPhone },
  });
  const { register, handleSubmit, formState, reset } = form;

  const submit = handleSubmit(async (values) => {
    try {
      const updated = await update.mutateAsync({
        businessName: values.businessName,
        contactPhone: normalizeEthiopianPhone(values.contactPhone) ?? values.contactPhone,
      });
      reset({ businessName: updated.businessName, contactPhone: updated.contactPhone });
      toast.success('Profile updated', { description: 'Your invoices will use the new details.' });
    } catch (error) {
      handleFormError(error, form);
    }
  });

  return (
    <Card className="h-full">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Building2 className="size-4 text-primary" /> Business profile
          </span>
        }
        description="Business name and contact phone can be changed here; they appear on your invoices."
      />
      <CardContent className="flex flex-col gap-5">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Business profile">
          {formState.errors.root?.server && (
            <Alert tone="danger">{formState.errors.root.server.message}</Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name" required error={formState.errors.businessName?.message}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  autoComplete="organization"
                  aria-describedby={describedBy}
                  invalid={invalid}
                  {...register('businessName')}
                />
              )}
            </Field>
            <Field label="Contact phone" required error={formState.errors.contactPhone?.message}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  aria-describedby={describedBy}
                  invalid={invalid}
                  {...register('contactPhone')}
                />
              )}
            </Field>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-fg-subtle">
              {formState.isDirty ? 'Unsaved changes' : 'Saved to your account'}
            </p>
            <Button
              type="submit"
              size="sm"
              disabled={!formState.isDirty}
              loading={update.isPending || formState.isSubmitting}
              leadingIcon={<Save className="size-4" />}
            >
              Save changes
            </Button>
          </div>
        </form>

        <DescriptionList
          className="border-t border-border pt-4"
          items={[
            { term: 'Registration number', detail: profile.businessRegistrationNumber },
            { term: 'Contact email', detail: profile.contactEmail },
            { term: 'Advertiser since', detail: formatDate(profile.createdAt) },
            { term: 'Account ID', detail: <code className="text-xs">{profile.id}</code> },
          ]}
        />
        <Alert tone="info">
          The registration number and contact email identify your business and cannot be edited here. Email{' '}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>{' '}
          from your registered address to change them.
        </Alert>
      </CardContent>
    </Card>
  );
}
