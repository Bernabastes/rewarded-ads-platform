import type { AdvertiserLedgerEntryType, InvoiceStatus, PaymentStatus } from '../enums';
import type { IsoDateTime, Uuid } from './common';

export interface WalletBalanceResponse {
  balanceEtb: number;
  currency: 'ETB';
  /** Sum of budgets currently reserved by non-final campaigns. */
  reservedEtb: number;
  lifetimeTopupsEtb: number;
  lifetimeSpendEtb: number;
}

export interface AdvertiserLedgerEntry {
  id: Uuid;
  amountEtb: number;
  balanceAfterEtb: number;
  entryType: AdvertiserLedgerEntryType;
  referenceType: string | null;
  referenceId: Uuid | null;
  description: string | null;
  createdAt: IsoDateTime;
}

export interface CreateTopupDto {
  /** ETB, >= 100. */
  amountEtb: number;
  /** Where the gateway should send the browser after checkout (advertiser web URL). */
  returnUrl?: string;
}

export interface TopupResponse {
  paymentId: Uuid;
  txRef: string;
  amountEtb: number;
  status: PaymentStatus;
  /** Redirect the advertiser's browser here. In mock mode this is a local fake checkout page. */
  checkoutUrl: string;
  /** true when the gateway runs in mock mode (no CHAPA_SECRET_KEY configured). */
  mock: boolean;
}

export interface PaymentItem {
  id: Uuid;
  txRef: string;
  gateway: string;
  amountEtb: number;
  currency: 'ETB';
  status: PaymentStatus;
  checkoutUrl: string | null;
  gatewayReference: string | null;
  paidAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPriceEtb: number;
  totalEtb: number;
}

export interface InvoiceItem {
  id: Uuid;
  invoiceNumber: string;
  status: InvoiceStatus;
  subtotalEtb: number;
  vatEtb: number;
  totalEtb: number;
  currency: 'ETB';
  lineItems: InvoiceLineItem[];
  paymentId: Uuid | null;
  issuedAt: IsoDateTime;
  paidAt: IsoDateTime | null;
}
