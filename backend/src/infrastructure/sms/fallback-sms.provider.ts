import { Logger } from '@nestjs/common';
import { maskPhone } from '../../common/phone.js';
import { SmsDeliveryError, SmsMessage, SmsProvider, SmsSendResult } from './sms-provider.js';

/**
 * Primary provider with an automatic backup: when the primary refuses or is unreachable the
 * identical message (same code) goes through the backup. Bodies are never logged.
 */
export class FallbackSmsProvider implements SmsProvider {
  readonly name: string;
  private readonly logger = new Logger('SMS:fallback');

  constructor(
    private readonly primary: SmsProvider,
    private readonly backup: SmsProvider,
  ) {
    this.name = `${primary.name}+${backup.name}`;
  }

  async send(message: SmsMessage): Promise<SmsSendResult> {
    try {
      return await this.primary.send(message);
    } catch (err) {
      const code = err instanceof SmsDeliveryError ? (err.providerCode ?? 'n/a') : 'n/a';
      this.logger.warn(
        `${this.primary.name} failed for ${maskPhone(message.to)} (code=${code}) — trying ${this.backup.name}`,
      );
    }
    const result = await this.backup.send(message);
    this.logger.log(`SMS to ${maskPhone(message.to)} accepted by ${this.backup.name} (backup)`);
    return result;
  }
}
