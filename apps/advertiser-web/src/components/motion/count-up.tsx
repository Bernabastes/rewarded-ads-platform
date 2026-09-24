import { animate, useInView, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils/cn';

export interface CountUpProps {
  value: number;
  /** Format the interpolated value for display. Defaults to a grouped integer. */
  format?: (value: number) => string;
  duration?: number;
  className?: string;
  /** Start animating only once scrolled into view (default false: animate on mount). */
  inView?: boolean;
}

const defaultFormat = (v: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(v);

/** Animated number that eases from the previous value to the next; static under prefers-reduced-motion. */
export function CountUp({ value, format = defaultFormat, duration = 1.1, className, inView = false }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' });
  const reduceMotion = useReducedMotion();
  const previous = useRef(0);
  const [display, setDisplay] = useState(() => format(reduceMotion ? value : 0));
  const shouldAnimate = !reduceMotion && (isInView || !inView);

  useEffect(() => {
    if (!shouldAnimate) {
      if (reduceMotion) {
        previous.current = value;
        queueMicrotask(() => setDisplay(format(value)));
      }
      return;
    }
    const from = previous.current;
    const controls = animate(from, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setDisplay(format(latest)),
      onComplete: () => {
        previous.current = value;
        setDisplay(format(value));
      },
    });
    return () => controls.stop();
  }, [value, duration, format, shouldAnimate, reduceMotion]);

  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {display}
    </span>
  );
}
