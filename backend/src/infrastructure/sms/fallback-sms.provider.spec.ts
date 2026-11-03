import { Logger } from '@nestjs/common';
import { FallbackSmsProvider } from './fallback-sms.provider.js';
import { SmsDeliveryError } from './sms-provider.js';

const provider = (name: string, fails = false) => ({
  name,
  send: fails
    ? vi.fn().mockRejectedValue(new SmsDeliveryError(`${name} down`, name, 21608))
    : vi.fn().mockResolvedValue({ providerMessageId: `${name}-1` }),
});
const msg = { to: '+971501234567', body: 'Your TowNow verification code is 123456.' };

describe('FallbackSmsProvider', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('uses only the primary when it accepts', async () => {
    const [p, b] = [provider('twilio'), provider('infobip')];
    await expect(new FallbackSmsProvider(p, b).send(msg)).resolves.toEqual({
      providerMessageId: 'twilio-1',
    });
    expect(b.send).not.toHaveBeenCalled();
  });

  it('sends the identical message via the backup when the primary fails, never logging it', async () => {
    const [p, b] = [provider('twilio', true), provider('infobip')];
    await expect(new FallbackSmsProvider(p, b).send(msg)).resolves.toEqual({
      providerMessageId: 'infobip-1',
    });
    expect(b.send).toHaveBeenCalledWith(msg);
    const logged = warn.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(logged).toContain('code=21608');
    expect(logged).not.toContain('123456');
    expect(logged).not.toContain(msg.to);
  });

  it('throws the backup error when both fail', async () => {
    const [p, b] = [provider('twilio', true), provider('infobip', true)];
    await expect(new FallbackSmsProvider(p, b).send(msg)).rejects.toThrow('infobip down');
  });
});
