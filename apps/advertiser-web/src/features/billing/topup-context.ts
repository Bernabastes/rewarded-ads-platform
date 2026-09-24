/**
 * Remembers where a top-up was started from so the billing page can send the advertiser back
 * (e.g. to the wizard review step) once the payment settles. The mock gateway ignores custom
 * returnUrls and always lands on /billing?topup=<txRef>, so context is keyed by txRef.
 */
export interface TopupContext {
  paymentId: string;
  txRef: string;
  amountEtb: number;
  /** In-app path to return to after settlement. */
  returnTo?: string;
  /** Human label for the return action. */
  returnLabel?: string;
  createdAt: number;
}

const KEY = 'gize.billing.topups';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function read(): Record<string, TopupContext> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, TopupContext>) : {};
    const now = Date.now();
    for (const [txRef, ctx] of Object.entries(parsed)) {
      if (!ctx || now - ctx.createdAt > MAX_AGE_MS) delete parsed[txRef];
    }
    return parsed;
  } catch {
    return {};
  }
}

function write(map: Record<string, TopupContext>) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // ignore storage failures
  }
}

export const topupContextStore = {
  save(ctx: Omit<TopupContext, 'createdAt'>) {
    const map = read();
    map[ctx.txRef] = { ...ctx, createdAt: Date.now() };
    write(map);
  },
  get(txRef: string): TopupContext | null {
    return read()[txRef] ?? null;
  },
  /** Most recently started top-up (used when the gateway returns without a reference). */
  latest(): TopupContext | null {
    const all = Object.values(read()).sort((a, b) => b.createdAt - a.createdAt);
    return all[0] ?? null;
  },
  remove(txRef: string) {
    const map = read();
    delete map[txRef];
    write(map);
  },
};
