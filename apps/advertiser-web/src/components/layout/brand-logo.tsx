import { BRAND_NAME } from '@/config/brand';
import { cn } from '@/lib/utils/cn';

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('size-9', className)} aria-hidden="true">
      <rect width="64" height="64" rx="16" className="fill-primary" />
      <circle cx="32" cy="32" r="17" fill="none" className="stroke-primary-fg" strokeWidth="4" />
      <path
        d="M32 21v11l8 5"
        fill="none"
        className="stroke-accent dark:stroke-terracotta-300"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BrandLogo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <BrandMark />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="text-display text-lg font-bold tracking-tight text-fg">{BRAND_NAME}</span>
          <span className="text-[11px] font-medium tracking-wide text-fg-subtle uppercase">for Business</span>
        </span>
      )}
    </span>
  );
}
