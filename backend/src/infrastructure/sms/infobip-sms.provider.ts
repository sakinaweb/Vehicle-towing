import { Logger } from '@nestjs/common';
import { maskPhone } from '../../common/phone.js';
import { SmsDeliveryError, SmsMessage, SmsProvider, SmsSendResult } from './sms-provider.js';

export interface InfobipConfig {
  /** Account-specific API base from the Infobip portal, e.g. https://xxxxx.api.infobip.com */
  baseUrl: string;
  apiKey: string;
  /** Registered sender ID (UAE: TDRA-approved alphanumeric) or number. */
  sender: string;
  /** Where Infobip posts delivery reports (optional). */
  notifyUrl?: string;
  timeoutMs?: number;
}

interface InfobipResponse {
  messages?: {
    messageId?: string;
    status?: { groupName?: string; name?: string; description?: string };
  }[];
  requestError?: { serviceException?: { messageId?: string; text?: string } };
}

/** Sends SMS through Infobip's SMS API v2 over REST (no SDK, same approach as Twilio). */
export class InfobipSmsProvider implements SmsProvider {
  readonly name = 'infobip';
  private readonly logger = new Logger('SMS:infobip');

  constructor(
    private readonly config: InfobipConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: SmsMessage): Promise<SmsSendResult> {
    const { baseUrl, apiKey, sender, notifyUrl } = this.config;
    const body = {
      messages: [
        {
          destinations: [{ to: message.to.replace(/^\+/, '') }],
          from: sender,
          text: message.body,
          ...(notifyUrl && { notifyUrl, notifyContentType: 'application/json' }),
        },
      ],
    };

    let response: Response;
    try {
      response = await this.fetchImpl(`${baseUrl}/sms/2/text/advanced`, {
        method: 'POST',
        headers: {
          Authorization: `App ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new SmsDeliveryError(`Infobip unreachable: ${reason}`, this.name);
    }

    const payload = (await response.json().catch(() => ({}))) as InfobipResponse;
    const sent = payload.messages?.[0];
    // A 200 can still carry a per-message REJECTED status (bad number, no route, no balance).
    if (!response.ok || !sent?.messageId || sent.status?.groupName === 'REJECTED') {
      const error = payload.requestError?.serviceException;
      const code = error?.messageId ?? sent?.status?.name;
      const text = error?.text ?? sent?.status?.description ?? `Infobip HTTP ${response.status}`;
      this.logger.error(
        `Infobip rejected SMS to ${maskPhone(message.to)}: HTTP ${response.status} code=${code ?? 'n/a'} ${text}`,
      );
      throw new SmsDeliveryError(text, this.name, code);
    }
    return { providerMessageId: sent.messageId };
  }
}
