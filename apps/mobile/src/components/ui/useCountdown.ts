import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Second-by-second countdown shared by the OTP screens (resend timer) and the phone screen
 * (429 OTP_RATE_LIMITED lock). `restart(seconds)` arms it again; it stops itself at 0.
 */
export function useCountdown(initialSeconds = 0) {
  const [seconds, setSeconds] = useState(Math.max(0, Math.floor(initialSeconds)));
  // Absolute deadline so a backgrounded tab / throttled timer still lands on the right second.
  const endsAt = useRef<number | null>(null);

  useEffect(() => {
    if (seconds <= 0) {
      endsAt.current = null;
      return;
    }
    if (endsAt.current === null) endsAt.current = Date.now() + seconds * 1000;
    const timer = setInterval(() => {
      const remaining = endsAt.current ? Math.ceil((endsAt.current - Date.now()) / 1000) : 0;
      setSeconds(Math.max(0, remaining));
    }, 1000);
    return () => clearInterval(timer);
  }, [seconds]);

  const restart = useCallback((value: number) => {
    const safe = Math.max(0, Math.floor(value));
    endsAt.current = safe > 0 ? Date.now() + safe * 1000 : null;
    setSeconds(safe);
  }, []);

  const clear = useCallback(() => restart(0), [restart]);

  return { seconds, active: seconds > 0, restart, clear };
}
