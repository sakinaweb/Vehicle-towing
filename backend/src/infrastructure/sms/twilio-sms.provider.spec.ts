import { Logger } from '@nestjs/common';
import { SmsDeliveryError } from './sms-provider.js';
import { TwilioSmsProvider } from './twilio-sms.provider.js';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('TwilioSmsProvider', () => {
  beforeAll(() => vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));

  const config = { accountSid: 'AC123', authToken: 'secret', sender: '+15005550006' };

  it('posts a form-encoded message with basic auth and returns the message sid', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { sid: 'SM42' }));
    const provider = new TwilioSmsProvider(config, fetchMock);

    await expect(provider.send({ to: '+971501234567', body: 'Code 123456' })).resolves.toEqual({
      providerMessageId: 'SM42',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('AC123:secret').toString('base64')}`,
    );
    const form = init.body as URLSearchParams;
    expect(form.get('To')).toBe('+971501234567');
    expect(form.get('Body')).toBe('Code 123456');
    expect(form.get('From')).toBe('+15005550006');
  });

  it('uses MessagingServiceSid for MG… senders', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { sid: 'SM1' }));
    await new TwilioSmsProvider({ ...config, sender: 'MG999' }, fetchMock).send({
      to: '+971501234567',
      body: 'x',
    });
    const form = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as URLSearchParams;
    expect(form.get('MessagingServiceSid')).toBe('MG999');
    expect(form.has('From')).toBe(false);
  });

  it('throws SmsDeliveryError with the Twilio error code on rejection', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(400, { code: 21211, message: "Invalid 'To' Phone Number" }));
    const error = await new TwilioSmsProvider(config, fetchMock)
      .send({ to: '+971501234567', body: 'x' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SmsDeliveryError);
    expect(error).toMatchObject({ provider: 'twilio', providerCode: 21211 });
  });

  it('throws SmsDeliveryError when Twilio cannot be reached', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(
      new TwilioSmsProvider(config, fetchMock).send({ to: '+971501234567', body: 'x' }),
    ).rejects.toThrow(/Twilio unreachable: fetch failed/);
  });
});
