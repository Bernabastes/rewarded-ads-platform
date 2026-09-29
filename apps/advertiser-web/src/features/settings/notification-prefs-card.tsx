import type { AdvertiserNotificationPrefs, AdvertiserProfile } from '@rap/shared';
import { Bell } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Switch } from '@/components/ui/primitives';
import { toastApiError } from '@/lib/forms';
import { useUpdateAdvertiserProfile } from './hooks';

export const PREF_ITEMS: Array<{ key: keyof AdvertiserNotificationPrefs; label: string; description: string }> =
  [
    {
      key: 'campaignReviews',
      label: 'Campaign review decisions',
      description: 'When a campaign or creative is approved or rejected.',
    },
    {
      key: 'billing',
      label: 'Billing',
      description: 'Top-up confirmations, invoices and low-balance warnings.',
    },
    {
      key: 'weeklyReport',
      label: 'Weekly performance report',
      description: 'A Monday summary of verified views, spend and filtered fraud.',
    },
  ];

/** Notification preferences stored on the account (`notificationPrefs` via `PATCH /advertisers/me`). */
export function NotificationPrefsCard({ profile }: { profile: AdvertiserProfile }) {
  const update = useUpdateAdvertiserProfile();
  const prefs = profile.notificationPrefs;

  return (
    <Card className="h-full">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Bell className="size-4 text-primary" /> Notifications
          </span>
        }
        description={`Emails to ${profile.contactEmail}. Saved to your account and applied on every device.`}
      />
      <CardContent>
        <ul className="flex flex-col divide-y divide-border">
          {PREF_ITEMS.map((item) => (
            <li key={item.key} className="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
              <div>
                <p id={`pref-${item.key}`} className="text-sm font-medium text-fg">
                  {item.label}
                </p>
                <p className="text-xs text-fg-subtle">{item.description}</p>
              </div>
              <Switch
                checked={prefs[item.key]}
                disabled={update.isPending}
                aria-labelledby={`pref-${item.key}`}
                onCheckedChange={(checked) => {
                  update
                    .mutateAsync({ notificationPrefs: { [item.key]: checked } })
                    .then(() => toast.success('Preference saved'))
                    .catch(toastApiError);
                }}
              />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
