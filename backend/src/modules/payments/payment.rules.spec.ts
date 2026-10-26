import { PaymentStatus as P } from '../../common/enums.js';
import { calculateFare } from '../pricing/fare.calculator.js';
import {
  canTransition,
  formatInvoiceNumber,
  settlement,
  signStripePayload,
  statusFromIntent,
  verifyStripeSignature,
} from './payment.rules.js';

describe('payment status transitions', () => {
  it('follows authorise → capture → refund', () => {
    expect(canTransition(P.Pending, P.Authorized)).toBe(true);
    expect(canTransition(P.Authorized, P.Captured)).toBe(true);
    expect(canTransition(P.Captured, P.Refunded)).toBe(true);
  });

  it('lets a declined card be retried, but never reopens final states', () => {
    expect(canTransition(P.Failed, P.Authorized)).toBe(true);
    expect(canTransition(P.Refunded, P.Captured)).toBe(false);
    expect(canTransition(P.Cancelled, P.Authorized)).toBe(false);
    expect(canTransition(P.Captured, P.Authorized)).toBe(false); // late webhook
    expect(canTransition(P.Captured, P.Cancelled)).toBe(false);
  });
});

describe('statusFromIntent', () => {
  it.each([
    ['requires_capture', P.Authorized],
    ['succeeded', P.Captured],
    ['canceled', P.Cancelled],
    ['requires_action', P.Pending],
    ['processing', P.Pending],
    ['requires_payment_method', P.Pending],
  ])('%s → %s', (status, expected) => {
    expect(statusFromIntent({ status })).toBe(expected);
  });

  it('treats a declined attempt as failed', () => {
    expect(
      statusFromIntent({
        status: 'requires_payment_method',
        last_payment_error: { code: 'card_declined' },
      }),
    ).toBe(P.Failed);
  });
});

describe('settlement (20% default commission, VAT excluded)', () => {
  it('splits the fare excluding VAT', () => {
    // AED 250.00 fare + AED 12.50 VAT: commission AED 50.00, driver AED 200.00
    expect(settlement(25_000, 2000)).toEqual({ commissionFils: 5000, driverEarningFils: 20_000 });
  });

  it('rounds commission to whole fils and never loses a fils', () => {
    const { commissionFils, driverEarningFils } = settlement(28_157, 2000);
    expect(commissionFils).toBe(5631); // 5631.4 → 5631
    expect(commissionFils + driverEarningFils).toBe(28_157);
  });

  it('matches the fare calculator: VAT is 5% of the subtotal and total = subtotal + VAT', () => {
    const fare = calculateFare(
      {
        baseFareFils: 15_000,
        perKmFils: 480,
        minimumFareFils: 15_000,
        towTypeSurchargeFils: 5000,
        nightSurchargeFils: 3500,
        vatRateBps: 500,
        currency: 'AED',
      },
      14_000,
      new Date('2026-10-10T08:00:00Z'), // 12:00 UAE, no night surcharge
    );
    expect(fare.subtotalFils).toBe(26_720); // 150 + 14 km × 4.80 + 50
    expect(fare.vatFils).toBe(1336);
    expect(fare.vatFils).toBe(Math.round(fare.subtotalFils * 0.05));
    expect(fare.totalFils).toBe(fare.subtotalFils + fare.vatFils);
  });
});

describe('Stripe webhook signatures', () => {
  const secret = 'whsec_test_secret';
  const body = Buffer.from('{"id":"evt_1","type":"payment_intent.succeeded"}');
  const now = 1_790_000_000;

  it('accepts a correctly signed, fresh payload', () => {
    expect(verifyStripeSignature(body, signStripePayload(body, secret, now), secret, now)).toEqual({
      ok: true,
    });
  });

  it('accepts when any of several v1 signatures matches (secret rotation)', () => {
    const good = signStripePayload(body, secret, now).split(',')[1];
    expect(verifyStripeSignature(body, `t=${now},v1=deadbeef,${good}`, secret, now)).toEqual({
      ok: true,
    });
  });

  it('rejects tampered bodies, wrong secrets, stale timestamps and junk', () => {
    const header = signStripePayload(body, secret, now);
    expect(
      verifyStripeSignature(
        Buffer.from(body.toString().replace('evt_1', 'evt_2')),
        header,
        secret,
        now,
      ),
    ).toEqual({
      ok: false,
      reason: 'signature mismatch',
    });
    expect(verifyStripeSignature(body, header, 'whsec_other', now)).toMatchObject({ ok: false });
    expect(verifyStripeSignature(body, header, secret, now + 301)).toEqual({
      ok: false,
      reason: 'timestamp outside tolerance',
    });
    expect(verifyStripeSignature(body, undefined, secret, now)).toEqual({
      ok: false,
      reason: 'missing signature',
    });
    expect(verifyStripeSignature(body, 'nonsense', secret, now)).toEqual({
      ok: false,
      reason: 'malformed signature',
    });
  });
});

it('formats sequential invoice numbers', () => {
  expect(formatInvoiceNumber(1)).toBe('INV-000001');
  expect(formatInvoiceNumber(1234567)).toBe('INV-1234567');
});
