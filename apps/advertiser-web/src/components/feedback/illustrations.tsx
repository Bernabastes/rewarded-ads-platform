import type { SVGProps } from 'react';

type IllustrationProps = SVGProps<SVGSVGElement> & { className?: string };

const base = {
  viewBox: '0 0 240 160',
  fill: 'none',
  role: 'img' as const,
  'aria-hidden': true,
};

/** Empty campaigns: a clean stage with a play button waiting for a first creative. */
export function EmptyCampaignsIllustration(props: IllustrationProps) {
  return (
    <svg {...base} {...props}>
      <rect
        x="28"
        y="30"
        width="184"
        height="104"
        rx="14"
        className="fill-surface-muted stroke-border-strong"
        strokeWidth="2"
      />
      <rect
        x="44"
        y="46"
        width="152"
        height="60"
        rx="8"
        className="fill-surface stroke-border"
        strokeWidth="2"
      />
      <circle cx="120" cy="76" r="18" className="fill-primary" />
      <path d="M115 67v18l14-9-14-9z" className="fill-primary-fg" />
      <rect x="44" y="114" width="70" height="8" rx="4" className="fill-border-strong" />
      <rect x="122" y="114" width="40" height="8" rx="4" className="fill-border" />
      <circle cx="196" cy="40" r="12" className="fill-accent-soft" />
      <path d="M190 40h12M196 34v12" className="stroke-accent" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="40" cy="128" r="4" className="fill-terracotta-300" />
      <circle cx="204" cy="120" r="3" className="fill-forest-300" />
    </svg>
  );
}

/** Empty chart / analytics. */
export function EmptyDataIllustration(props: IllustrationProps) {
  return (
    <svg {...base} {...props}>
      <path d="M40 124h160" className="stroke-border-strong" strokeWidth="2" strokeLinecap="round" />
      <path d="M40 124V44" className="stroke-border-strong" strokeWidth="2" strokeLinecap="round" />
      <rect x="60" y="92" width="18" height="32" rx="4" className="fill-forest-200 dark:fill-forest-900" />
      <rect x="92" y="78" width="18" height="46" rx="4" className="fill-forest-300 dark:fill-forest-800" />
      <rect x="124" y="60" width="18" height="64" rx="4" className="fill-primary" />
      <rect x="156" y="98" width="18" height="26" rx="4" className="fill-accent" />
      <path
        d="M60 66c30 -14 60 -20 120 -26"
        className="stroke-fg-subtle"
        strokeWidth="2"
        strokeDasharray="4 5"
        strokeLinecap="round"
      />
      <circle cx="180" cy="40" r="6" className="fill-surface stroke-accent" strokeWidth="2.5" />
    </svg>
  );
}

/** Wallet / billing empty. */
export function WalletIllustration(props: IllustrationProps) {
  return (
    <svg {...base} {...props}>
      <rect x="52" y="44" width="136" height="88" rx="14" className="fill-primary" />
      <rect x="52" y="58" width="136" height="16" className="fill-forest-800/70" />
      <rect x="140" y="82" width="48" height="30" rx="8" className="fill-surface" />
      <circle cx="164" cy="97" r="6" className="fill-accent" />
      <rect x="66" y="96" width="44" height="6" rx="3" className="fill-forest-200" />
      <rect x="66" y="108" width="28" height="6" rx="3" className="fill-forest-300" />
      <circle cx="46" cy="52" r="8" className="fill-accent-soft" />
      <path d="M42 52h8M46 48v8" className="stroke-accent" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Generic error: a warm cloud with a warning chip. */
export function ErrorIllustration(props: IllustrationProps) {
  return (
    <svg {...base} {...props}>
      <path
        d="M70 116h104a26 26 0 0 0 4-51.7A38 38 0 0 0 105 52a30 30 0 0 0-52 20 22 22 0 0 0 17 44z"
        className="fill-surface-muted stroke-border-strong"
        strokeWidth="2"
      />
      <circle cx="120" cy="86" r="20" className="fill-danger/15" />
      <path d="M120 74v16" className="stroke-danger" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="120" cy="97" r="2.4" className="fill-danger" />
      <circle cx="184" cy="46" r="4" className="fill-terracotta-300" />
      <circle cx="54" cy="128" r="3" className="fill-forest-300" />
    </svg>
  );
}

/** 404: a signpost. */
export function NotFoundIllustration(props: IllustrationProps) {
  return (
    <svg {...base} {...props}>
      <path d="M120 44v88" className="stroke-border-strong" strokeWidth="4" strokeLinecap="round" />
      <path d="M96 132h48" className="stroke-border-strong" strokeWidth="4" strokeLinecap="round" />
      <path d="M68 52h84l12 12-12 12H68z" className="fill-primary" />
      <path d="M172 88H92L80 100l12 12h80z" className="fill-accent" />
      <rect x="80" y="60" width="52" height="6" rx="3" className="fill-primary-fg/80" />
      <rect x="110" y="96" width="46" height="6" rx="3" className="fill-accent-fg/70" />
      <circle cx="56" cy="40" r="3" className="fill-forest-300" />
      <circle cx="190" cy="132" r="4" className="fill-terracotta-200" />
    </svg>
  );
}

/** Upload: a tray with an arrow. */
export function UploadIllustration(props: IllustrationProps) {
  return (
    <svg {...base} {...props}>
      <path
        d="M60 104v16a10 10 0 0 0 10 10h100a10 10 0 0 0 10-10v-16"
        className="stroke-border-strong"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M120 100V40" className="stroke-primary" strokeWidth="4" strokeLinecap="round" />
      <path
        d="M100 60l20-20 20 20"
        className="stroke-primary"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="86" y="108" width="68" height="10" rx="5" className="fill-primary-soft" />
    </svg>
  );
}

/** Verified shield with a clock (pending) or check. */
export function VerificationIllustration({ verified, ...props }: IllustrationProps & { verified?: boolean }) {
  return (
    <svg {...base} {...props}>
      <path
        d="M120 30l52 18v34c0 30-22 50-52 60-30-10-52-30-52-60V48z"
        className={verified ? 'fill-primary' : 'fill-warning/20 stroke-warning'}
        strokeWidth="2.5"
      />
      {verified ? (
        <path
          d="M98 82l14 14 30-32"
          className="stroke-primary-fg"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <>
          <circle cx="120" cy="82" r="22" className="fill-surface stroke-warning" strokeWidth="3" />
          <path
            d="M120 68v14l10 6"
            className="stroke-warning"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  );
}
