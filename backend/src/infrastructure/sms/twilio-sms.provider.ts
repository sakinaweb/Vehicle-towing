import { Logger } from '@nestjs/common';
import { maskPhone } from '../../common/phone.js';
import { SmsDeliveryError, SmsMessage, SmsProvider, SmsSendResult } from './sms-provider.js';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** E.164 number, registered alphanumeric sender ID, or Messaging Service SID (MG…). */
  sender: string;
  /** Where Twilio posts delivery status (optional). */
  statusCallbackUrl?: string;
  /** Overridable for tests. */
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Sends SMS through Twilio's Programmable Messaging REST API (no SDK needed).
 * UAE note: alphanumeric sender IDs must be pre-registered with the TDRA.
 */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';
  private readonly logger = new Logger('SMS:twilio');

  constructor(
    private readonly config: TwilioConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: SmsMessage): Promise<SmsSendResult> {
    const { accountSid, authToken, sender } = this.config;
    const url = `${this.config.baseUrl ?? 'https://api.twilio.com'}/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
    const form = new URLSearchParams({ To: message.to, Body: message.body });
    form.set(sender.startsWith('MG') ? 'MessagingServiceSid' : 'From', sender);
    if (this.config.statusCallbackUrl) form.set('StatusCallback', this.config.statusCallbackUrl);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form,
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new SmsDeliveryError(`Twilio unreachable: ${reason}`, this.name);
    }

    const payload = (await response.json().catch(() => ({}))) as {
      sid?: string;
      code?: number;
      message?: string;
    };
    if (!response.ok || !payload.sid) {
      this.logger.error(
        `Twilio rejected SMS to ${maskPhone(message.to)}: HTTP ${response.status} code=${payload.code ?? 'n/a'} ${payload.message ?? ''}`,
      );
      throw new SmsDeliveryError(
        payload.message ?? `Twilio HTTP ${response.status}`,
        this.name,
        payload.code,
      );
    }
    return { providerMessageId: payload.sid };
  }
}
