import { Clock, ShieldCheck, ShieldX } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '@/features/auth/auth-provider';
import { Alert } from '../ui/alert';

/** Explains what unverified advertisers can and cannot do. Hidden for verified accounts. */
export function VerificationBanner({ className }: { className?: string }) {
  const { profile } = useAuth();
  if (!profile || profile.verificationStatus === 'verified') return null;

  if (profile.verificationStatus === 'rejected') {
    return (
      <Alert
        tone="danger"
        icon={<ShieldX className="size-5" />}
        title="Your business verification was not approved"
        className={className}
      >
        {profile.verificationNote ? <p className="mb-1">Reason: {profile.verificationNote}</p> : null}
        <p>
          Contact support to update your registration details. You can keep drafting campaigns, but they
          cannot be submitted until verification is approved.
        </p>
      </Alert>
    );
  }

  return (
    <Alert
      tone="warning"
      icon={<Clock className="size-5" />}
      title="Your business is being verified"
      className={className}
      action={
        <Link to="/settings" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          View details
        </Link>
      }
    >
      <p>
        Our team checks every new business registration (usually within one working day). Meanwhile you can{' '}
        <strong className="font-medium text-fg">add funds, build campaign drafts and upload creatives</strong>
        . Submitting a campaign for review unlocks once you are verified — sign in again after approval to
        refresh your status.
      </p>
    </Alert>
  );
}

export function VerifiedHint() {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
      <ShieldCheck className="size-3.5" /> Verified business
    </span>
  );
}
