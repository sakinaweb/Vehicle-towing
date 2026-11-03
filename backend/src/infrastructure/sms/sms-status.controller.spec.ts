import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import type { AppConfigService } from '../../config/app-config.service.js';
import {
  infobipCallbackToken,
  SmsStatusController,
  twilioSignature,
} from './sms-status.controller.js';

const base = 'https://api.example.test/api/v1';
const secret = 's'.repeat(48);
const config = (statusCallbackBaseUrl?: string) =>
  ({
    sms: { statusCallbackBaseUrl, twilio: { authToken: 'tok' } },
    otp: { secret },
  }) as unknown as AppConfigService;

const twilioBody = {
  MessageSid: 'SM1',
  MessageStatus: 'undelivered',
  ErrorCode: '30007',
  To: '+971501234567',
};

describe('SmsStatusController', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('accepts a correctly signed Twilio report and logs failures with a masked number', () => {
    const sig = twilioSignature('tok', `${base}/sms/status/twilio`, twilioBody);
    new SmsStatusController(config(base)).twilio(sig, twilioBody);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain('undelivered error=30007');
    expect(line).toContain('+97150*****67');
  });

  it('rejects unsigned or tampered Twilio reports', () => {
    const c = new SmsStatusController(config(base));
    const sig = twilioSignature('tok', `${base}/sms/status/twilio`, twilioBody);
    expect(() => c.twilio(undefined, twilioBody)).toThrow(ForbiddenException);
    expect(() => c.twilio(sig, { ...twilioBody, MessageStatus: 'delivered' })).toThrow(
      ForbiddenException,
    );
  });

  it('checks the Infobip secret path token', () => {
    const c = new SmsStatusController(config(base));
    const body = {
      results: [{ messageId: 'IB1', to: '971501234567', status: { groupName: 'UNDELIVERABLE' } }],
    };
    expect(() => c.infobip('wrong', body)).toThrow(ForbiddenException);
    c.infobip(infobipCallbackToken(secret), body);
    expect(String(warn.mock.calls[0][0])).toContain('UNDELIVERABLE');
  });

  it('is disabled while no callback base URL is configured', () => {
    expect(() => new SmsStatusController(config()).twilio('x', twilioBody)).toThrow(
      NotFoundException,
    );
  });
});
