import { Logger } from '@nestjs/common';
import { InfobipSmsProvider } from './infobip-sms.provider.js';
import { SmsDeliveryError } from './sms-provider.js';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const config = { baseUrl: 'https://x.api.infobip.com', apiKey: 'test-key', sender: 'TowNow' };
const accepted = { messages: [{ messageId: 'IB1', status: { groupName: 'PENDING' } }] };
const msg = { to: '+971501234567', body: 'Code 1' };

describe('InfobipSmsProvider', () => {
  beforeAll(() => vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));

  it('posts JSON with App-key auth and returns the message id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, accepted));
    await expect(new InfobipSmsProvider(config, fetchMock).send(msg)).resolves.toEqual({
      providerMessageId: 'IB1',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://x.api.infobip.com/sms/2/text/advanced');
    expect((init.headers as Record<string, string>).Authorization).toBe('App test-key');
    expect(JSON.parse(init.body as string)).toEqual({
      messages: [{ destinations: [{ to: '971501234567' }], from: 'TowNow', text: 'Code 1' }],
    });
  });

  it('asks for delivery reports when a notify URL is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, accepted));
    await new InfobipSmsProvider({ ...config, notifyUrl: 'https://api/x' }, fetchMock).send(msg);
    const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string).messages[0]).toMatchObject({
      notifyUrl: 'https://api/x',
      notifyContentType: 'application/json',
    });
  });

  it('treats a 200 with a REJECTED message as a failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        messages: [
          {
            messageId: 'IB2',
            status: {
              groupName: 'REJECTED',
              name: 'REJECTED_DESTINATION',
              description: 'no route',
            },
          },
        ],
      }),
    );
    const err = await new InfobipSmsProvider(config, fetchMock).send(msg).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SmsDeliveryError);
    expect(err).toMatchObject({ provider: 'infobip', providerCode: 'REJECTED_DESTINATION' });
  });

  it('reports auth errors and an unreachable API as SmsDeliveryError', async () => {
    const unauthorized = vi.fn().mockResolvedValue(
      jsonResponse(401, {
        requestError: {
          serviceException: { messageId: 'UNAUTHORIZED', text: 'Invalid login details' },
        },
      }),
    );
    await expect(new InfobipSmsProvider(config, unauthorized).send(msg)).rejects.toMatchObject({
      providerCode: 'UNAUTHORIZED',
      message: 'Invalid login details',
    });

    const offline = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(new InfobipSmsProvider(config, offline).send(msg)).rejects.toThrow(
      /Infobip unreachable/,
    );
  });
});
