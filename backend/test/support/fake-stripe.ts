import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';

export interface FakeIntent {
  id: string;
  object: 'payment_intent';
  status: string;
  amount: number;
  amount_capturable: number;
  amount_received: number;
  currency: string;
  capture_method: string;
  client_secret: string;
  metadata: Record<string, string>;
  last_payment_error: { code: string; message: string } | null;
}

/**
 * In-memory stand-in for the Stripe endpoints TowNow calls. Honours Idempotency-Key
 * like Stripe (same key → same response), so duplicate-charge protection is tested
 * end to end. Never contacts Stripe; no real money is involved.
 */
export class FakeStripe {
  readonly intents = new Map<string, FakeIntent>();
  readonly calls: { method: string; path: string; idempotencyKey?: string }[] = [];
  refunds = 0;
  private readonly idempotent = new Map<string, unknown>();
  private server!: Server;
  private seq = 0;

  async start(): Promise<string> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop(): Promise<void> {
    return new Promise((r) => this.server.close(() => r()));
  }

  /** What Stripe.js does when the customer's card is approved for a manual-capture intent. */
  authorize(id: string): FakeIntent {
    const pi = this.intents.get(id)!;
    Object.assign(pi, {
      status: 'requires_capture',
      amount_capturable: pi.amount,
      last_payment_error: null,
    });
    return pi;
  }

  decline(id: string): FakeIntent {
    const pi = this.intents.get(id)!;
    Object.assign(pi, {
      status: 'requires_payment_method',
      last_payment_error: { code: 'card_declined', message: 'Your card was declined.' },
    });
    return pi;
  }

  callsTo(method: string, pathPart: string) {
    return this.calls.filter((c) => c.method === method && c.path.includes(pathPart));
  }

  private async handle(req: IncomingMessage, res: import('node:http').ServerResponse) {
    const body = await new Promise<string>((r) => {
      let data = '';
      req.on('data', (c: Buffer) => (data += c.toString()));
      req.on('end', () => r(data));
    });
    const params = Object.fromEntries(new URLSearchParams(body));
    const path = req.url ?? '';
    const key = req.headers['idempotency-key'] as string | undefined;
    this.calls.push({ method: req.method!, path, idempotencyKey: key });
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (!req.headers.authorization?.startsWith('Bearer sk_test_')) {
      return send(401, { error: { message: 'Invalid API Key provided' } });
    }
    if (key && this.idempotent.has(key)) return send(200, this.idempotent.get(key));
    const ok = (payload: unknown) => {
      if (key) this.idempotent.set(key, structuredClone(payload));
      send(200, payload);
    };
    const fail = (message: string) =>
      send(400, { error: { message, code: 'payment_intent_unexpected_state' } });

    let m: RegExpMatchArray | null;
    if (req.method === 'POST' && path === '/v1/payment_intents') {
      const id = `pi_test_${++this.seq}`;
      const pi: FakeIntent = {
        id,
        object: 'payment_intent',
        status: 'requires_payment_method',
        amount: Number(params.amount),
        amount_capturable: 0,
        amount_received: 0,
        currency: params.currency,
        capture_method: params.capture_method,
        client_secret: `${id}_secret_test`,
        metadata: {
          bookingId: params['metadata[bookingId]'],
          bookingNumber: params['metadata[bookingNumber]'],
        },
        last_payment_error: null,
      };
      this.intents.set(id, pi);
      return ok(pi);
    }
    if (req.method === 'GET' && (m = path.match(/^\/v1\/payment_intents\/([\w]+)$/))) {
      const pi = this.intents.get(m[1]);
      return pi ? send(200, pi) : send(404, { error: { message: 'No such payment_intent' } });
    }
    if (
      req.method === 'POST' &&
      (m = path.match(/^\/v1\/payment_intents\/([\w]+)\/(capture|cancel)$/))
    ) {
      const pi = this.intents.get(m[1]);
      if (!pi) return send(404, { error: { message: 'No such payment_intent' } });
      if (m[2] === 'capture') {
        if (pi.status !== 'requires_capture')
          return fail(`Cannot capture a ${pi.status} PaymentIntent`);
        Object.assign(pi, {
          status: 'succeeded',
          amount_received: pi.amount,
          amount_capturable: 0,
        });
      } else {
        if (pi.status === 'succeeded' || pi.status === 'canceled')
          return fail(`Cannot cancel a ${pi.status} PaymentIntent`);
        Object.assign(pi, { status: 'canceled', amount_capturable: 0 });
      }
      return ok(pi);
    }
    if (req.method === 'POST' && path === '/v1/refunds') {
      const pi = this.intents.get(params.payment_intent);
      if (!pi || pi.status !== 'succeeded') return fail('Charge has not been captured');
      this.refunds += 1;
      return ok({ id: `re_test_${this.refunds}`, status: 'succeeded', payment_intent: pi.id });
    }
    send(404, { error: { message: `Unhandled fake route ${req.method} ${path}` } });
  }
}
