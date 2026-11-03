import { Logger } from '@nestjs/common';
import { AndroidGatewaySmsProvider } from './android-gateway-sms.provider.js';
import { SmsDeliveryError } from './sms-provider.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const config = {
  baseUrl: 'http://192.168.1.20:8080',
  apiKey: 'test-key',
  statusWatchMs: 50,
  statusPollMs: 1,
};
const msg = { to: '+971501234567', body: 'Your TowNow verification code is 123456.' };

describe('AndroidGatewaySmsProvider', () => {
  let log: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('posts the documented JSON with the API key and returns the gateway sms_id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { success: true, sms_id: 42, status: 'PENDING' }))
      .mockImplementation(() => Promise.resolve(json(200, { sms_id: 42, status: 'DELIVERED' })));
    await expect(new AndroidGatewaySmsProvider(config, fetchMock).send(msg)).resolves.toEqual({
      providerMessageId: '42',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://192.168.1.20:8080/api/send');
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('test-key');
    expect(JSON.parse(init.body as string)).toEqual({ phone_number: msg.to, message: msg.body });
    await new Promise((r) => setTimeout(r, 30)); // let the background delivery watch finish
  });

  it('reports delivery only as the phone reports it, and never logs the message text', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { status: 'SENT' }))
      .mockResolvedValueOnce(json(200, { status: 'DELIVERED' }));
    const final = await new AndroidGatewaySmsProvider(config, fetchMock).watchDelivery(7, msg.to);
    expect(final).toBe('DELIVERED');
    const lines = log.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((l: string) => l.includes('SMS 7 '));
    expect(lines).toEqual([
      expect.stringContaining('SMS 7 to +97150*****67: SENT'),
      expect.stringContaining('SMS 7 to +97150*****67: DELIVERED — reported by the gateway phone'),
    ]);
    expect(lines.join()).not.toContain('123456');
  });

  it('says "NOT confirmed" when no final report arrives in time', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(json(200, { status: 'SENT' })));
    const final = await new AndroidGatewaySmsProvider(config, fetchMock).watchDelivery(8, msg.to);
    expect(final).toBe('SENT');
    expect(String(warn.mock.calls.at(-1)?.[0])).toContain('NOT confirmed');
  });

  it('turns refusals and an unreachable phone into SmsDeliveryError (so a backup can take over)', async () => {
    const refused = vi.fn().mockResolvedValue(
      json(401, {
        success: false,
        error: 'Invalid API key',
        error_code: 'AUTHENTICATION_FAILED',
      }),
    );
    await expect(new AndroidGatewaySmsProvider(config, refused).send(msg)).rejects.toMatchObject({
      provider: 'android_gateway',
      providerCode: 'AUTHENTICATION_FAILED',
    });
    const offline = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const err = await new AndroidGatewaySmsProvider(config, offline)
      .send(msg)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SmsDeliveryError);
    expect((err as Error).message).toContain('Gateway phone unreachable');
  });
});
