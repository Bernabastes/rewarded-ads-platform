import { ScrollText } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { AcceptTermsDialog } from './terms-dialog';

const DEFERRED_KEY = 'gize.terms.deferred-version';

function readDeferredVersion(): string | null {
  try {
    return window.sessionStorage.getItem(DEFERRED_KEY);
  } catch {
    return null;
  }
}

/**
 * Consent gate for signed-in advertisers. When the cached profile says `requiresTermsAcceptance` (new terms
 * version published, or none accepted yet) the accept dialog opens automatically once per version and a
 * persistent banner stays until the current version is accepted. Campaign submission is blocked server-side
 * (`403 CONSENT_REQUIRED`) until then, so "Not now" only defers the modal — it never hides the requirement.
 */
export function TermsGate({ className }: { className?: string }) {
  const { profile } = useAuth();
  const required = !!profile?.requiresTermsAcceptance;
  const currentVersion = profile?.currentTermsVersion ?? 'unknown';
  // Derived, not synchronised: the modal is open while the requirement stands and this version was not deferred.
  // The deferral is kept in sessionStorage so navigating between pages does not re-open the modal.
  const [deferredVersion, setDeferredVersionState] = useState<string | null>(readDeferredVersion);
  const [manuallyOpened, setManuallyOpened] = useState(false);
  const open = required && (manuallyOpened || deferredVersion !== currentVersion);
  const setDeferredVersion = (version: string) => {
    setDeferredVersionState(version);
    try {
      window.sessionStorage.setItem(DEFERRED_KEY, version);
    } catch {
      // ignore storage failures
    }
  };

  if (!profile || !required) return null;

  const versionLabel = profile.currentTermsVersion ? ` (v${profile.currentTermsVersion})` : '';

  return (
    <>
      <Alert
        tone="warning"
        icon={<ScrollText className="size-5" />}
        title={
          profile.acceptedTermsVersion
            ? `Updated advertiser terms${versionLabel} need your acceptance`
            : `Please accept the advertiser terms${versionLabel}`
        }
        className={className}
        data-testid="terms-banner"
        action={
          <Button size="sm" onClick={() => setManuallyOpened(true)}>
            Review and accept
          </Button>
        }
      >
        {profile.acceptedTermsVersion
          ? `You accepted version ${profile.acceptedTermsVersion}. Submitting campaigns stays paused until the current version is accepted; everything else keeps working.`
          : 'Campaigns can be drafted and funded now, but submitting for review requires the current terms to be accepted.'}
      </Alert>
      <AcceptTermsDialog
        open={open}
        onOpenChange={(next) => {
          if (next) {
            setManuallyOpened(true);
            return;
          }
          setManuallyOpened(false);
          setDeferredVersion(currentVersion);
        }}
        title="Accept the advertiser terms to continue"
        description="These terms govern every campaign you run — including the banned-topics policy and prepaid billing."
      />
    </>
  );
}
