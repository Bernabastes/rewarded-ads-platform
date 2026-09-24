import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';

/** Ease-out cubic. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Pure interpolation used by the hook (exported for tests). */
export function countUpValue(from: number, to: number, elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0 || elapsedMs >= durationMs) return to;
  const progress = easeOutCubic(Math.max(0, elapsedMs) / durationMs);
  return Math.round(from + (to - from) * progress);
}

/**
 * Animates a number from its previous value to `target` (used for the coin count-up).
 * Jumps straight to the target when the system asks for reduced motion.
 */
export function useCountUp(target: number, durationMs = 900, options: { enabled?: boolean; from?: number } = {}) {
  const enabled = options.enabled ?? true;
  const reduceMotion = useReducedMotion();
  const [value, setValue] = useState(options.from ?? 0);
  const fromRef = useRef(options.from ?? 0);

  useEffect(() => {
    if (!enabled) return;
    if (reduceMotion || durationMs <= 0) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const from = fromRef.current;
    const start = Date.now();
    let frame: ReturnType<typeof requestAnimationFrame> | null = null;
    const tick = () => {
      const elapsed = Date.now() - start;
      const next = countUpValue(from, target, elapsed, durationMs);
      setValue(next);
      if (elapsed < durationMs) frame = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      fromRef.current = target;
    };
  }, [target, durationMs, enabled, reduceMotion]);

  return value;
}
