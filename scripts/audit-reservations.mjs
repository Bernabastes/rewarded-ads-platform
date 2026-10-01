#!/usr/bin/env node
/**
 * One-off data audit for security finding #1 (campaign budget reservation replay).
 *
 * For every campaign it compares `campaigns.budget_reserved_etb` (the cached reservation) with the NET amount the
 * advertiser wallet ledger actually holds for the campaign (reservations are negative wallet entries, refunds
 * positive, so net = -(sum)). The identity that must hold:
 *
 *   draft / rejected / completed -> net ledger reservation == budget_reserved_etb == spent_etb (or 0)
 *   pending_review / active / paused -> net ledger reservation == budget_reserved_etb == budget_etb (+ increases)
 *
 * A campaign whose cached reservation exceeds what the wallet was really debited for is an UNFUNDED campaign
 * (the exploit of audit finding #1); a live campaign whose reservation is below its budget is UNDERFUNDED
 * (Phase 5b New-1: the PATCH-budget / submit race). Exit code 1 when any discrepancy is found.
 *
 *   node scripts/audit-reservations.mjs            # uses DATABASE_URL from .env (repo root or apps/api)
 *   node scripts/audit-reservations.mjs --json     # machine-readable output
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
for (const candidate of [path.join(root, 'apps', 'api', '.env'), path.join(root, '.env')]) {
  if (existsSync(candidate)) {
    try {
      process.loadEnvFile(candidate);
    } catch {
      /* ignore */
    }
    break;
  }
}
for (const key of Object.keys(process.env)) {
  const v = process.env[key];
  if (typeof v === 'string' && /\s#/.test(v)) process.env[key] = v.replace(/\s+#.*$/, '').trim();
}

const require = createRequire(path.join(root, 'apps', 'api', 'package.json'));
const { PrismaClient, Prisma } = require('@prisma/client');
const prisma = new PrismaClient();
const json = process.argv.includes('--json');

const rows = await prisma.$queryRaw`
  SELECT c.id, c.title, c.status::text AS status, c.submission_seq, c.budget_etb, c.spent_etb, c.budget_reserved_etb,
    COALESCE((SELECT -SUM(l.amount_etb) FROM advertiser_wallet_ledger l
              WHERE l.reference_type = 'campaign' AND l.reference_id = c.id
                AND l.entry_type IN ('campaign_budget_reservation', 'campaign_budget_refund')), 0) AS net_ledger_etb,
    (SELECT COUNT(*)::int FROM advertiser_wallet_ledger l
      WHERE l.reference_type = 'campaign' AND l.reference_id = c.id AND l.entry_type = 'campaign_budget_reservation') AS reservations,
    (SELECT COUNT(*)::int FROM advertiser_wallet_ledger l
      WHERE l.reference_type = 'campaign' AND l.reference_id = c.id AND l.entry_type = 'campaign_budget_refund') AS refunds
  FROM campaigns c ORDER BY c.created_at`;

const LIVE = new Set(['pending_review', 'active', 'paused']);
const findings = [];
for (const r of rows) {
  const reserved = new Prisma.Decimal(r.budget_reserved_etb);
  const net = new Prisma.Decimal(r.net_ledger_etb);
  const spent = new Prisma.Decimal(r.spent_etb);
  const budget = new Prisma.Decimal(r.budget_etb);
  const problems = [];
  if (!reserved.equals(net)) {
    problems.push(`cached reservation ${reserved} != net wallet reservation ${net}${reserved.greaterThan(net) ? ' (UNFUNDED by ' + reserved.minus(net) + ' ETB)' : ''}`);
  }
  if (LIVE.has(r.status) && reserved.lessThan(budget)) {
    problems.push(`UNDERFUNDED live campaign (New-1): reserved ${reserved} < budget ${budget} - users could be paid ${budget.minus(reserved)} ETB from platform money`);
  }
  if (!LIVE.has(r.status) && r.status !== 'draft' && !reserved.equals(spent)) {
    problems.push(`${r.status} campaign reserved ${reserved} != spent ${spent} (refund missing or incomplete)`);
  }
  if (r.status === 'draft' && !net.isZero()) problems.push(`draft campaign still has ${net} ETB reserved in the wallet`);
  if (problems.length) findings.push({ id: r.id, title: r.title, status: r.status, submissionSeq: r.submission_seq, budgetEtb: budget.toNumber(), spentEtb: spent.toNumber(), reservedEtb: reserved.toNumber(), netLedgerEtb: net.toNumber(), reservations: r.reservations, refunds: r.refunds, problems });
}

await prisma.$disconnect();

if (json) {
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), campaigns: rows.length, discrepancies: findings }, null, 2));
} else {
  console.log(`Reservation audit: ${rows.length} campaign(s) checked, ${findings.length} discrepanc${findings.length === 1 ? 'y' : 'ies'}`);
  for (const f of findings) {
    console.log(`\n  ${f.status.padEnd(15)} ${f.title} (${f.id}) seq=${f.submissionSeq}`);
    console.log(`    budget=${f.budgetEtb} spent=${f.spentEtb} reserved=${f.reservedEtb} netLedger=${f.netLedgerEtb} entries=${f.reservations}r/${f.refunds}f`);
    for (const p of f.problems) console.log(`    - ${p}`);
  }
  if (!findings.length) console.log('  every campaign\'s cached reservation matches the wallet ledger');
}
process.exit(findings.length ? 1 : 0);
