import { useCallback, useEffect, useState } from 'react';

import { toast } from '@/components/ui/Toast';
import { i18n } from '@/i18n';

import {
  clearWatchSession,
  decideResume,
  loadWatchSession,
  type PersistedWatchSession,
  type ResumeDecision,
} from './watchSessionStorage';

export interface InterruptedSession {
  session: PersistedWatchSession;
  decision: Exclude<ResumeDecision, 'discard'>;
}

/**
 * Looks for a watch session left on disk by a previous app run and decides what to do with it.
 * Sessions that cannot be safely resumed are discarded (with a friendly notice) so the user can
 * simply watch the ad again - never re-credited, never silently lost.
 */
export function useInterruptedWatchSession() {
  const [pending, setPending] = useState<InterruptedSession | null>(null);
  const [checked, setChecked] = useState(false);

  const check = useCallback(async () => {
    const session = await loadWatchSession();
    if (!session) {
      setPending(null);
      setChecked(true);
      return;
    }
    const decision = decideResume(session);
    if (decision === 'discard') {
      await clearWatchSession();
      toast.info(i18n.t('ad.interrupted.body'));
      setPending(null);
    } else {
      setPending({ session, decision });
    }
    setChecked(true);
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const dismiss = useCallback(async () => {
    await clearWatchSession();
    setPending(null);
  }, []);

  return { pending, checked, dismiss, recheck: check };
}
