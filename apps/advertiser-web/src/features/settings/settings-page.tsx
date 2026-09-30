import { Palette, RefreshCw, ShieldCheck } from 'lucide-react';
import { VerificationIllustration } from '@/components/feedback/illustrations';
import { PageHeader } from '@/components/layout/page-header';
import { ThemeSegmented } from '@/components/layout/theme-toggle';
import { VerificationBanner } from '@/components/layout/verification-banner';
import { PageTransition, Stagger, StaggerItem } from '@/components/motion/motion';
import { VerificationBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useAuth } from '@/features/auth/auth-provider';
import { LegalCard } from './legal-card';
import { NotificationPrefsCard } from './notification-prefs-card';
import { ProfileCard } from './profile-card';
import { SecurityCard } from './security-card';
import { useAdvertiserProfile } from './use-advertiser-profile';

export function SettingsPage() {
  const { profile: cached } = useAuth();
  // Fresh copy from GET /advertisers/me (also patches the cached session profile); fall back to the cache.
  const fresh = useAdvertiserProfile({ staleTime: 0 });
  const profile = fresh.data ?? cached;
  if (!profile) return null;

  return (
    <PageTransition className="flex flex-col gap-6">
      <PageHeader
        title="Account settings"
        description="Your business profile, verification status, notifications, legal terms and security."
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void fresh.refetch()}
            loading={fresh.isFetching}
            leadingIcon={<RefreshCw className="size-4" />}
          >
            Refresh status
          </Button>
        }
      />
      <VerificationBanner />

      <Stagger className="grid gap-4 lg:grid-cols-3">
        <StaggerItem className="lg:col-span-2">
          <ProfileCard key={`${profile.id}:${profile.businessName}:${profile.contactPhone}`} profile={profile} />
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
                    ? 'We are checking your registration against the business registry. Drafts and top-ups are available now; submitting unlocks after approval. This page refreshes your status automatically.'
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
          <LegalCard profile={profile} />
        </StaggerItem>
        <StaggerItem>
          <NotificationPrefsCard profile={profile} />
        </StaggerItem>
      </Stagger>

      <Stagger className="grid gap-4 lg:grid-cols-2">
        <StaggerItem>
          <SecurityCard />
        </StaggerItem>
        <StaggerItem>
          <Card className="h-full">
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
        </StaggerItem>
      </Stagger>
    </PageTransition>
  );
}