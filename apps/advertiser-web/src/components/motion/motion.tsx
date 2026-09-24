import { motion, useReducedMotion, type HTMLMotionProps, type Transition, type Variants } from 'framer-motion';
import type { ReactNode } from 'react';

export const EASE_OUT: Transition['ease'] = [0.16, 1, 0.3, 1];

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_OUT } },
};

export const staggerContainer = (stagger = 0.06, delay = 0.05): Variants => ({
  hidden: {},
  visible: { transition: { staggerChildren: stagger, delayChildren: delay } },
});

/** Wrap a route element: fades/slides it in on mount. */
export function PageTransition({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

/** Parent for staggered reveals; children use <StaggerItem>. */
export function Stagger({
  children,
  className,
  stagger,
  delay,
  ...props
}: HTMLMotionProps<'div'> & { children: ReactNode; stagger?: number; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={staggerContainer(stagger, delay)}
      initial={reduce ? 'visible' : 'hidden'}
      animate="visible"
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className, ...props }: HTMLMotionProps<'div'> & { children: ReactNode }) {
  return (
    <motion.div className={className} variants={fadeUp} {...props}>
      {children}
    </motion.div>
  );
}

/** Reveal a chart once mounted (clip from the left). */
export function ChartReveal({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, clipPath: 'inset(0 100% 0 0)' }}
      animate={{ opacity: 1, clipPath: 'inset(0 0% 0 0)' }}
      transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.1 }}
    >
      {children}
    </motion.div>
  );
}
