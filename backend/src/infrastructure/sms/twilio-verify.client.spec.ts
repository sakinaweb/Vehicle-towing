import { Logger } from '@nestjs/common';
import { SmsDeliveryError } from './sms-provider.js';
import { TwilioVerifyClient } from './twilio-verify.client.js';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Obviously fake identifiers (never real credentials).
const config = {
  apiKeySid: 'SK' + '0'.repeat(32),
  apiKeySecret: 'test-secret',
  serviceSid: 'VA' + '1'.repeat(32),
  baseUrl: 'https://verify.twilio.com',
};

describe('TwilioVerifyClient', () => {
  beforeAll(() => vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));

  it('starts an SMS verification with API-key basic auth', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { sid: 'VE1', status: 'pending' }));
    await new TwilioVerifyClient(config, fetchMock).start('+971501234567');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://verify.twilio.com/v2/Services/${config.serviceSid}/Verifications`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from(`${config.apiKeySid}:test-secret`).toString('base64')}`,
    );
    const form = init.body as URLSearchParams;
    expect(form.get('To')).toBe('+971501234567');
    expect(form.get('Channel')).toBe('sms');
  });

  it('reports Twilio refusals with the provider code (e.g. 60200 invalid number)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(400, { code: 60200, message: 'Invalid parameter `To`' }));
    const err = await new TwilioVerifyClient(config, fetchMock).start('+97150').catch((e) => e);
    expect(err).toBeInstanceOf(SmsDeliveryError);
    expect(err).toMatchObject({ provider: 'twilio_verify', providerCode: 60200 });
  });

  it('maps check results: approved, incorrect, expired (404), too many attempts (60202)', async () => {
    const client = (res: Response) =>
      new TwilioVerifyClient(config, vi.fn().mockResolvedValue(res));
    await expect(
      client(jsonResponse(200, { status: 'approved', valid: true })).check(
        '+971501234567',
        '123456',
      ),
    ).resolves.toBe('approved');
    await expect(
      client(jsonResponse(200, { status: 'pending', valid: false })).check(
        '+971501234567',
        '000000',
      ),
    ).resolves.toBe('incorrect');
    await expect(
      client(jsonResponse(404, { code: 20404, message: 'not found' })).check('+971501234567', '1'),
    ).resolves.toBe('expired');
    await expect(
      client(jsonResponse(429, { code: 60202, message: 'Max check attempts reached' })).check(
        '+971501234567',
        '1',
      ),
    ).resolves.toBe('too_many_attempts');
  });

  it('sends To and Code to VerificationCheck', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'approved' }));
    await new TwilioVerifyClient(config, fetchMock).check('+971501234567', '654321');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://verify.twilio.com/v2/Services/${config.serviceSid}/VerificationCheck`,
    );
    const form = init.body as URLSearchParams;
    expect(form.get('To')).toBe('+971501234567');
    expect(form.get('Code')).toBe('654321');
  });

  it('throws on server errors and when Twilio is unreachable', async () => {
    const down = new TwilioVerifyClient(config, vi.fn().mockResolvedValue(jsonResponse(503, {})));
    await expect(down.check('+971501234567', '1')).rejects.toBeInstanceOf(SmsDeliveryError);
    const offline = new TwilioVerifyClient(
      config,
      vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    );
    await expect(offline.start('+971501234567')).rejects.toThrow(/unreachable/);
  });
});
