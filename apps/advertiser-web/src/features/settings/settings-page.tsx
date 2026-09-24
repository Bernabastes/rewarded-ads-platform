import { Bell, Building2, KeyRound, LogOut, Palette, ShieldCheck } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { VerificationIllustration } from '@/components/feedback/illustrations';
import { PageHeader } from '@/components/layout/page-header';
import { ThemeSegmented } from '@/components/layout/theme-toggle';
import { VerificationBanner } from '@/components/layout/verification-banner';
import { PageTransition, Stagger, StaggerItem } from '@/components/motion/motion';
import { Alert } from '@/components/ui/alert';
import { VerificationBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Switch } from '@/components/ui/primitives';
import { DescriptionList } from '@/components/ui/table';
import { BRAND_NAME, SUPPORT_EMAIL } from '@/config/brand';
import { useAuth } from '@/features/auth/auth-provider';
import { formatDate } from '@/lib/utils/format';

interface NotificationPrefs {
  campaignReviews: boolean;
  budgetAlerts: boolean;
  paymentReceipts: boolean;
  weeklyDigest: boolean;
}

const PREFS_KEY = 'gize.notification-prefs';
const DEFAULT_PREFS: NotificationPrefs = {
  campaignReviews: true,
  budgetAlerts: true,
  paymentReceipts: true,
  weeklyDigest: false,
};
const prefListeners = new Set<() => void>();
let prefsCache: NotificationPrefs | null = null;

function readPrefs(): NotificationPrefs {
  if (prefsCache) return prefsCache;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    prefsCache = raw
      ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<NotificationPrefs>) }
      : DEFAULT_PREFS;
  } catch {
    prefsCache = DEFAULT_PREFS;
  }
  return prefsCache;
}

function writePrefs(next: NotificationPrefs) {
  prefsCache = next;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  for (const listener of prefListeners) listener();
}

function useNotificationPrefs() {
  const prefs = useSyncExternalStore(
    (listener) => {
      prefListeners.add(listener);
      return () => prefListeners.delete(listener);
    },
    readPrefs,
    () => DEFAULT_PREFS,
  );
  return { prefs, update: (patch: Partial<NotificationPrefs>) => writePrefs({ ...readPrefs(), ...patch }) };
}

const PREF_ITEMS: Array<{ key: keyof NotificationPrefs; label: string; description: string }> = [
  {
    key: 'campaignReviews',
    label: 'Campaign review decisions',
    description: 'When a campaign or creative is approved or rejected.',
  },
  {
    key: 'budgetAlerts',
    label: 'Budget alerts',
    description: 'When a campaign has spent 80% of its budget or is paused for lack of funds.',
  },
  {
    key: 'paymentReceipts',
    label: 'Payment receipts',
    description: 'Confirmation and invoice for every wallet top-up.',
  },
  {
    key: 'weeklyDigest',
    label: 'Weekly performance digest',
    description: 'A Monday summary of verified views, spend and filtered fraud.',
  },
];

export function SettingsPage() {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const { prefs, update } = useNotificationPrefs();
  if (!profile) return null;

  return (
    <PageTransition className="flex flex-col gap-6">
      <PageHeader
        title="Account settings"
        description="Your business profile, verification status, notifications and appearance."
      />
      <VerificationBanner />

      <Stagger className="grid gap-4 lg:grid-cols-3">
        <StaggerItem className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Building2 className="size-4 text-primary" /> Business profile
                </span>
              }
              description="As registered with us. These details appear on your invoices."
            />
            <CardContent className="flex flex-col gap-5">
              <DescriptionList
                items={[
                  { term: 'Business name', detail: <span lang="und">{profile.businessName}</span> },
                  { term: 'Registration number', detail: profile.businessRegistrationNumber },
                  { term: 'Contact email', detail: profile.contactEmail },
                  { term: 'Contact phone', detail: profile.contactPhone },
                  { term: 'Advertiser since', detail: formatDate(profile.createdAt) },
                  { term: 'Account ID', detail: <code className="text-xs">{profile.id}</code> },
                ]}
              />
              <Alert tone="info">
                Profile changes are verified manually to keep the marketplace trustworthy. Email{' '}
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {SUPPORT_EMAIL}
                </a>{' '}
                from your registered address and we will update them within one working day.
              </Alert>
            </CardContent>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Card className="h-full">
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-primary" /> Verification
                </span>
              }
            />
            <CardContent className="flex flex-col items-center gap-4 text-center">
              <VerificationIllustration
                verified={profile.verificationStatus === 'verified'}
                className="h-auto w-40"
              />
              <VerificationBadge status={profile.verificationStatus} />
              <p className="text-sm text-fg-muted">
                {profile.verificationStatus === 'verified'
                  ? 'Your business registration has been checked. You can submit campaigns and they go to creative review immediately.'
                  : profile.verificationStatus === 'pending'
                    ? 'We are checking your registration against the business registry. Drafts and top-ups are available now; submitting unlocks after approval. Sign in again to refresh your status.'
                    : 'Your registration could not be verified. Contact support to correct your details.'}
              </p>
              {profile.verificationNote && (
                <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-fg-muted">
                  Note from our team: {profile.verificationNote}
                </p>
              )}
            </CardContent>
          </Card>
        </StaggerItem>
      </Stagger>

      <Stagger className="grid gap-4 lg:grid-cols-2">
        <StaggerItem>
          <Card className="h-full">
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Bell className="size-4 text-primary" /> Notifications
                </span>
              }
              description="Emails to your contact address. Saved on this device until account-level preferences ship on the API."
            />
            <CardContent>
              <ul className="flex flex-col divide-y divide-border">
                {PREF_ITEMS.map((item) => (
                  <li
                    key={item.key}
                    className="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0"
                  >
                    <div>
                      <p id={`pref-${item.key}`} className="text-sm font-medium text-fg">
                        {item.label}
                      </p>
                      <p className="text-xs text-fg-subtle">{item.description}</p>
                    </div>
                    <Switch
                      checked={prefs[item.key]}
                      aria-labelledby={`pref-${item.key}`}
                      onCheckedChange={(checked) => {
                        update({ [item.key]: checked });
                        toast.success('Preference saved');
                      }}
                    />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </StaggerItem>

        <StaggerItem className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Palette className="size-4 text-primary" /> Appearance
                </span>
              }
              description="Follows your system by default."
            />
            <CardContent>
              <ThemeSegmented />
            </CardContent>
          </Card>
          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <KeyRound className="size-4 text-primary" /> Security
                </span>
              }
            />
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm text-fg-muted">
                Self-service password changes are not available yet. To reset your password, email{' '}
                {SUPPORT_EMAIL} from your registered contact address. Sessions expire after 15 minutes of
                inactivity unless you chose “Keep me signed in”.
              </p>
              <Button
                variant="outline"
                className="self-start"
                onClick={() => {
                  void logout().then(() => {
                    toast.success(`Signed out of ${BRAND_NAME}`);
                    navigate('/login', { replace: true });
                  });
                }}
                leadingIcon={<LogOut className="size-4" />}
              >
                Sign out of this device
              </Button>
            </CardContent>
          </Card>
        </StaggerItem>
      </Stagger>
    </PageTransition>
  );
}
