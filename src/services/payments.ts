import { ApiClient } from './api';
import type { PaymentMethod } from '../types';

export type PaymentStatus = 'pending' | 'authorized' | 'captured' | 'failed' | 'refunded' | 'cancelled';

export interface PaymentSummary {
  id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amountFils: number;
  currency: string;
  failureReason: string | null;
  authorizedAt: string | null;
  capturedAt: string | null;
  refundedAt: string | null;
}

/** Data for Stripe's payment form. The client secret only authorises this one payment. */
export interface PaymentSession {
  status: PaymentStatus;
  amountFils: number;
  currency: string;
  provider: 'stripe';
  clientSecret: string | null;
  publishableKey: string;
}

export interface Invoice {
  invoiceNumber: string;
  /** False until TowNow's TRN is configured: the document is a receipt, not a tax invoice. */
  isTaxInvoice: boolean;
  title: string;
  notice: string | null;
  issuedAt: string;
  bookingNumber: string;
  seller: { name: string; address: string | null; trn: string | null };
  customerName: string;
  subtotalFils: number;
  vatRateBps: number;
  vatFils: number;
  totalFils: number;
  currency: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus | null;
}

export interface LedgerEntry {
  id: string;
  /** null for settlements (remittance / payout), which belong to no booking. */
  bookingId: string | null;
  type: 'trip_earning' | 'cash_collected' | 'remittance' | 'payout';
  amountFils: number;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface DriverLedger {
  /** + TowNow owes the driver, − the driver owes TowNow (cash trips). */
  balanceFils: number;
  currency: string;
  entries: LedgerEntry[];
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'Awaiting payment',
  authorized: 'Card authorised (charged on completion)',
  captured: 'Paid',
  failed: 'Payment failed',
  refunded: 'Refunded',
  cancelled: 'Released — not charged',
};

export const getPaymentSession = (api: ApiClient, bookingId: string) =>
  api.request<PaymentSession>(`/bookings/${bookingId}/payment`, { method: 'POST' });
export const syncPayment = (api: ApiClient, bookingId: string) =>
  api.request<PaymentSummary>(`/bookings/${bookingId}/payment/sync`, { method: 'POST' });
export const getInvoice = (api: ApiClient, bookingId: string) =>
  api.request<Invoice>(`/bookings/${bookingId}/invoice`);
export const recordCashCollected = (api: ApiClient, bookingId: string, amountFils: number) =>
  api.request<PaymentSummary>(`/drivers/me/jobs/${bookingId}/cash-collected`, {
    method: 'POST',
    body: { amountFils },
  });
/** Methods the server accepts for new bookings (cash always; card / Apple Pay only with Stripe). */
export const getPaymentMethods = (api: ApiClient) =>
  api.request<{ methods: PaymentMethod[] }>('/payments/methods', { auth: false });
export const getEarnings = (api: ApiClient) => api.request<DriverLedger>('/drivers/me/earnings');

/** Plain-text copy of an invoice for download (amounts from the server, never recalculated). */
export function invoiceText(inv: Invoice, paymentLabel: string): string {
  const aed = (f: number) => `AED ${(f / 100).toFixed(2)}`;
  return [
    `${inv.seller.name} — ${inv.title}`,
    inv.seller.trn ? `TRN: ${inv.seller.trn}` : 'TRN: not registered — this receipt is not a tax invoice',
    ...(inv.seller.address ? [inv.seller.address] : []),
    '',
    `Invoice: ${inv.invoiceNumber}`,
    `Booking: ${inv.bookingNumber}`,
    `Issued: ${new Date(inv.issuedAt).toLocaleString('en-GB')}`,
    `Customer: ${inv.customerName}`,
    '',
    `Towing service (excl. VAT): ${aed(inv.subtotalFils)}`,
    `VAT (${inv.vatRateBps / 100}%): ${aed(inv.vatFils)}`,
    `Total: ${aed(inv.totalFils)}`,
    `Payment: ${paymentLabel}`,
  ].join('\n');
}
