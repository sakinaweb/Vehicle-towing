import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';

export interface StripePaymentIntent {
  id: string;
  status: string;
  amount: number;
  amount_capturable?: number;
  amount_received?: number;
  currency: string;
  client_secret?: string;
  metadata?: Record<string, string>;
  last_payment_error?: { code?: string; message?: string } | null;
}

export class StripeError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Stripe's form encoding: nested objects as key[sub]=value. */
function encode(params: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(params).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) return [];
    if (typeof v === 'object') return encode(v as Record<string, unknown>, key);
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return [];
    return [`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`];
  });
}

/**
 * Minimal Stripe REST client for the calls TowNow needs. Every write carries an
 * Idempotency-Key, so a retried request can never create a second charge.
 */
@Injectable()
export class StripeClient {
  constructor(private readonly config: AppConfigService) {}

  /** Authorise-only intent (capture_method=manual): funds are held, captured on completion. */
  createAuthorization(input: {
    amountFils: number;
    currency: string;
    bookingId: string;
    bookingNumber: string;
    idempotencyKey: string;
  }): Promise<StripePaymentIntent> {
    return this.call('POST', '/v1/payment_intents', input.idempotencyKey, {
      amount: input.amountFils, // AED is a 2-decimal currency: fils = Stripe minor units
      currency: input.currency.toLowerCase(),
      capture_method: 'manual',
      automatic_payment_methods: { enabled: true }, // card + Apple Pay where enabled
      description: `TowNow tow ${input.bookingNumber}`,
      metadata: { bookingId: input.bookingId, bookingNumber: input.bookingNumber },
    });
  }

  retrieve(intentId: string): Promise<StripePaymentIntent> {
    return this.call('GET', `/v1/payment_intents/${encodeURIComponent(intentId)}`);
  }

  capture(intentId: string, idempotencyKey: string): Promise<StripePaymentIntent> {
    return this.call(
      'POST',
      `/v1/payment_intents/${encodeURIComponent(intentId)}/capture`,
      idempotencyKey,
      {},
    );
  }

  /** Releases an uncaptured authorisation (customer cancelled / unpaid timeout). */
  cancel(intentId: string, idempotencyKey: string): Promise<StripePaymentIntent> {
    return this.call(
      'POST',
      `/v1/payment_intents/${encodeURIComponent(intentId)}/cancel`,
      idempotencyKey,
      {},
    );
  }

  /** Full refund of a captured payment. */
  refund(intentId: string, idempotencyKey: string): Promise<{ id: string; status: string }> {
    return this.call('POST', '/v1/refunds', idempotencyKey, { payment_intent: intentId });
  }

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    idempotencyKey?: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const { secretKey, apiBase } = this.config.payments.stripe;
    if (!secretKey) throw new StripeError(503, 'Card payments are not configured.');
    let res: Response;
    try {
      res = await fetch(`${apiBase}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(idempotencyKey && { 'Idempotency-Key': idempotencyKey }),
        },
        body: body ? encode(body).join('&') : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new StripeError(502, `Payment gateway unreachable: ${(err as Error).name}`);
    }
    const payload = (await res.json().catch(() => ({}))) as T & {
      error?: { message?: string; code?: string };
    };
    if (!res.ok) {
      // Stripe error messages never contain the API key.
      throw new StripeError(
        res.status,
        payload.error?.message ?? `Stripe HTTP ${res.status}`,
        payload.error?.code,
      );
    }
    return payload;
  }
}
