import { createHmac, timingSafeEqual } from 'node:crypto';
import { PaymentStatus as P } from '../../common/enums.js';

/**
 * Allowed payment status changes. Anything else (e.g. a late "authorized" webhook
 * after a refund, or "captured" on a cancelled payment) is ignored, so gateway
 * events can arrive twice or out of order without corrupting the record.
 * failed → pending/authorized: Stripe lets the customer retry the same intent.
 */
const NEXT: Record<P, P[]> = {
  [P.Pending]: [P.Authorized, P.Captured, P.Failed, P.Cancelled],
  [P.Failed]: [P.Pending, P.Authorized, P.Captured, P.Cancelled],
  [P.Authorized]: [P.Captured, P.Cancelled, P.Failed],
  [P.Captured]: [P.Refunded],
  [P.Refunded]: [],
  [P.Cancelled]: [],
};

export function canTransition(from: P, to: P): boolean {
  return NEXT[from].includes(to);
}

/** Stripe PaymentIntent.status → TowNow payment status. */
export function statusFromIntent(intent: { status: string; last_payment_error?: unknown }): P {
  switch (intent.status) {
    case 'requires_capture':
      return P.Authorized;
    case 'succeeded':
      return P.Captured;
    case 'canceled':
      return P.Cancelled;
    case 'requires_payment_method':
      return intent.last_payment_error ? P.Failed : P.Pending;
    default: // requires_confirmation, requires_action, processing
      return P.Pending;
  }
}

/**
 * Driver settlement for one trip. VAT belongs to TowNow (the supplier on the invoice),
 * so commission and earning are computed on the fare excluding VAT.
 */
export function settlement(subtotalFils: number, commissionBps: number) {
  const commissionFils = Math.round((subtotalFils * commissionBps) / 10_000);
  return { commissionFils, driverEarningFils: subtotalFils - commissionFils };
}

export const formatInvoiceNumber = (n: number) => `INV-${String(n).padStart(6, '0')}`;

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

/**
 * Verifies a Stripe-Signature header: "t=<unix>,v1=<hex hmac>[,v1=…]" where
 * hmac = HMAC-SHA256(secret, "<t>.<raw body>"). Rejects stale timestamps (replays).
 */
export function verifyStripeSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): SignatureCheck {
  if (!header) return { ok: false, reason: 'missing signature' };
  const parts = header.split(',').map((p) => p.split('=', 2) as [string, string]);
  const timestamp = Number(parts.find(([k]) => k === 't')?.[1]);
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(timestamp) || signatures.length === 0)
    return { ok: false, reason: 'malformed signature' };
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds)
    return { ok: false, reason: 'timestamp outside tolerance' };
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  const match = signatures.some((sig) => {
    const given = Buffer.from(sig, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  return match ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}

/** Builds a valid header — used by tests and the local webhook simulator. */
export function signStripePayload(
  rawBody: Buffer | string,
  secret: string,
  timestamp: number,
): string {
  const sig = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}
