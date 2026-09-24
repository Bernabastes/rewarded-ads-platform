import { motion, useReducedMotion } from 'framer-motion';
import { Eye, ShieldCheck, Sparkles, Timer } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { BrandLogo } from '@/components/layout/brand-logo';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { EASE_OUT } from '@/components/motion/motion';
import { BRAND_NAME, BRAND_NAME_AM, BRAND_TAGLINE } from '@/config/brand';

const POINTS = [
  { icon: Eye, title: 'Real attention, verified server-side', text: 'Every view is timed and checked before you pay a single birr.' },
  { icon: ShieldCheck, title: 'Fraud filtered out, transparently', text: 'See raw versus verified completions side by side in your analytics.' },
  { icon: Timer, title: 'Live in a day', text: 'Upload a creative, set a budget, and our team reviews it within 24 hours.' },
];

export function AuthLayout({ title, subtitle, children, footer }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-forest-800 text-forest-50 lg:flex lg:flex-col lg:justify-between lg:p-12 dark:bg-forest-950">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(60% 50% at 20% 10%, rgb(78 152 119 / 0.45), transparent 60%), radial-gradient(40% 40% at 90% 90%, rgb(217 98 43 / 0.35), transparent 60%)',
          }}
        />
        <div className="relative flex items-center justify-between">
          <span className="inline-flex items-center gap-2.5 text-forest-50">
            <span className="text-display text-2xl font-bold">{BRAND_NAME}</span>
            <span className="rounded-full border border-forest-300/40 px-2 py-0.5 text-xs font-medium tracking-wide text-forest-100 uppercase">
              for Business
            </span>
          </span>
          <span className="text-display text-3xl text-forest-200/80" lang="am">
            {BRAND_NAME_AM}
          </span>
        </div>
        <motion.div
          className="relative max-w-lg"
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.1 }}
        >
          <p className="inline-flex items-center gap-2 rounded-full bg-forest-700/60 px-3 py-1 text-xs font-medium text-forest-100">
            <Sparkles className="size-3.5 text-terracotta-300" /> Rewarded advertising for Ethiopia
          </p>
          <h2 className="text-display mt-5 text-4xl leading-tight font-bold text-white">{BRAND_TAGLINE}</h2>
          <p className="mt-4 text-base leading-relaxed text-forest-100/90">
            Your budget is only spent on completions that were watched, verified and passed our fraud checks. Everything else is
            filtered out — and we show you exactly how much.
          </p>
          <ul className="mt-8 flex flex-col gap-5">
            {POINTS.map((point, i) => (
              <motion.li
                key={point.title}
                className="flex gap-4"
                initial={reduce ? false : { opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.25 + i * 0.1 }}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-forest-700/70 text-terracotta-300">
                  <point.icon className="size-5" />
                </span>
                <span>
                  <span className="block font-semibold text-white">{point.title}</span>
                  <span className="block text-sm text-forest-100/80">{point.text}</span>
                </span>
              </motion.li>
            ))}
          </ul>
        </motion.div>
        <p className="relative text-xs text-forest-200/70">
          Sample campaign title rendered in Ethiopic: <span lang="am" className="text-forest-50">“ቡና ታይም — የጠዋት ቅልቅል”</span>
        </p>
      </aside>

      <main className="flex flex-col px-6 py-8 sm:px-10 lg:px-16">
        <div className="flex items-center justify-between">
          <Link to="/login" aria-label={`${BRAND_NAME} home`}>
            <BrandLogo />
          </Link>
          <ThemeToggle />
        </div>
        <motion.div
          className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10"
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: EASE_OUT }}
        >
          <h1 className="text-display text-3xl font-bold text-fg">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-fg-muted sm:text-base">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </motion.div>
        {footer && <div className="mx-auto w-full max-w-md text-center text-sm text-fg-muted">{footer}</div>}
      </main>
    </div>
  );
}
