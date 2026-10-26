import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { maskPhone } from '../../common/phone.js';
import { SmsMessage, SmsProvider, SmsSendResult } from './sms-provider.js';

/**
 * Development transport: writes the SMS to the API log instead of sending it,
 * so OTP sign-in works locally without a paid SMS account. Environment
 * validation refuses this provider when NODE_ENV=production.
 */
export class LogSmsProvider implements SmsProvider {
  readonly name = 'log';
  private readonly logger = new Logger('SMS:log');

  send(message: SmsMessage): Promise<SmsSendResult> {
    const id = `log-${randomUUID()}`;
    this.logger.warn(`[DEV ONLY] SMS to ${maskPhone(message.to)}: ${message.body}`);
    return Promise.resolve({ providerMessageId: id });
  }
}
