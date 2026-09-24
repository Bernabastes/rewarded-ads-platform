import type { CampaignAnalyticsTotals } from '@rap/shared';
import { ShieldCheck } from 'lucide-react';
import { CountUp } from '@/components/motion/count-up';
import { Tooltip } from '@/components/ui/primitives';
import { formatEtb, formatNumber, formatPercent } from '@/lib/utils/format';

export interface FraudSummary {
  filtered: number;
  flagged: number;
  rejected: number;
  raw: number;
  valid: number;
  rate: number;
  /** ETB the advertiser was NOT charged because completions were filtered. */
  savedEtb: number;
}

export function summarizeFraud(totals: Pick<CampaignAnalyticsTotals, 'rawCompletions' | 'validCompletions' | 'flaggedCompletions' | 'rejectedCompletions' | 'fraudFilteredRate'>, costPerActionEtb: number): FraudSummary {
  const filtered = totals.flaggedCompletions + totals.rejectedCompletions;
  return {
    filtered,
    flagged: totals.flaggedCompletions,
    rejected: totals.rejectedCompletions,
    raw: totals.rawCompletions,
    valid: totals.validCompletions,
    rate: totals.rawCompletions > 0 ? totals.fraudFilteredRate : 0,
    savedEtb: Math.round(filtered * costPerActionEtb * 100) / 100,
  };
}

/**
 * The product differentiator, made unmistakable: how many completions were filtered before billing, and what
 * that saved the advertiser.
 */
export function FraudFilterPanel({ summary, campaignTitle }: { summary: FraudSummary; campaignTitle?: string }) {
  const hasData = summary.raw > 0;
  return (
    <section
      aria-labelledby="fraud-panel-title"
      className="relative overflow-hidden rounded-lg border border-forest-700/40 bg-forest-800 p-6 text-forest-50 shadow-card sm:p-8 dark:bg-forest-950"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(60% 80% at 100% 0%, rgb(230 123 65 / 0.28), transparent 60%), radial-gradient(40% 60% at 0% 100%, rgb(78 152 119 / 0.35), transparent 60%)' }}
      />
      <div className="relative grid gap-8 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <p className="inline-flex items-center gap-2 rounded-full bg-forest-700/60 px-3 py-1 text-xs font-medium text-forest-100">
            <ShieldCheck className="size-3.5 text-terracotta-300" /> Fraud protection
          </p>
          <h2 id="fraud-panel-title" className="text-display mt-4 text-2xl leading-tight font-bold text-white sm:text-3xl">
            {hasData ? (
              <>
                We filtered <CountUp value={summary.filtered} className="text-terracotta-300" /> suspicious completion{summary.filtered === 1 ? '' : 's'} so you
                only pay for real attention.
              </>
            ) : (
              'Every completion is checked before you pay.'
            )}
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-forest-100/90 sm:text-base">
            {hasData ? (
              <>
                Out of <strong className="font-semibold text-white">{formatNumber(summary.raw)}</strong> completions{campaignTitle ? ` for “${campaignTitle}”` : ''},{' '}
                <strong className="font-semibold text-white">{formatNumber(summary.valid)}</strong> passed server-timed watch verification, device and
                behaviour checks. The other {formatPercent(summary.rate, 1)} were flagged or rejected — and never charged to you.
              </>
            ) : (
              'As soon as viewers start completing this campaign, this panel shows raw versus verified completions and what the filtering saved you.'
            )}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-4 lg:col-span-2">
          <div className="rounded-md bg-forest-900/50 p-4 ring-1 ring-forest-700/60">
            <dt className="text-xs font-medium text-forest-200">Filtered rate</dt>
            <dd className="text-display mt-1 text-2xl font-bold text-white tabular-nums">
              <CountUp value={summary.rate * 100} format={(v) => `${v.toFixed(1)}%`} />
            </dd>
          </div>
          <div className="rounded-md bg-forest-900/50 p-4 ring-1 ring-forest-700/60">
            <dt className="text-xs font-medium text-forest-200">Not charged</dt>
            <dd className="text-display mt-1 text-2xl font-bold text-terracotta-300 tabular-nums">
              <CountUp value={summary.savedEtb} format={(v) => formatEtb(v)} />
            </dd>
          </div>
          <div className="rounded-md bg-forest-900/50 p-4 ring-1 ring-forest-700/60">
            <dt className="text-xs font-medium text-forest-200">
              <Tooltip content="Completed, but with a suspicious signal (e.g. shared device fingerprint). Held back from billing while our team reviews.">
                <span className="cursor-help underline decoration-dotted underline-offset-4">Flagged</span>
              </Tooltip>
            </dt>
            <dd className="text-display mt-1 text-2xl font-bold text-white tabular-nums">{formatNumber(summary.flagged)}</dd>
          </div>
          <div className="rounded-md bg-forest-900/50 p-4 ring-1 ring-forest-700/60">
            <dt className="text-xs font-medium text-forest-200">
              <Tooltip content="Failed a hard check: too little watch time, missing heartbeats, wrong attention answer, or known fraud patterns.">
                <span className="cursor-help underline decoration-dotted underline-offset-4">Rejected</span>
              </Tooltip>
            </dt>
            <dd className="text-display mt-1 text-2xl font-bold text-white tabular-nums">{formatNumber(summary.rejected)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
