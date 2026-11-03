import { Logger } from '@nestjs/common';
import { maskPhone } from '../../common/phone.js';
import { SmsDeliveryError, SmsMessage, SmsProvider, SmsSendResult } from './sms-provider.js';

export interface AndroidGatewayConfig {
  /** The gateway phone on the local network, e.g. http://192.168.1.20:8080 (no trailing slash). */
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  /** How long to keep asking the phone for the delivery report (logged only). */
  statusWatchMs?: number;
  statusPollMs?: number;
}

interface GatewayReply {
  success?: boolean;
  sms_id?: number;
  status?: string;
  error?: string;
  error_code?: string;
  error_message?: string | null;
}

const FINAL = new Set(['DELIVERED', 'FAILED']);

/**
 * Free SMS through an Android phone running an "SMS gateway" app (HTTP API on the phone, sent
 * from that phone's own SIM). The phone only QUEUES the SMS; delivery is then read back from the
 * phone's status endpoint and logged — never assumed. LAN only: the API key travels unencrypted.
 */
export class AndroidGatewaySmsProvider implements SmsProvider {
  readonly name = 'android_gateway';
  private readonly logger = new Logger('SMS:android_gateway');

  constructor(
    private readonly config: AndroidGatewayConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: SmsMessage): Promise<SmsSendResult> {
    const reply = await this.call('/api/send', {
      method: 'POST',
      body: JSON.stringify({ phone_number: message.to, message: message.body }),
    });
    if (!reply.ok || reply.body.success !== true || reply.body.sms_id == null) {
      const code = reply.body.error_code ?? `HTTP ${reply.status}`;
      this.logger.error(
        `Gateway refused SMS to ${maskPhone(message.to)}: ${code} ${reply.body.error ?? ''}`,
      );
      throw new SmsDeliveryError(reply.body.error ?? `Gateway ${code}`, this.name, code);
    }
    const id = reply.body.sms_id;
    void this.watchDelivery(id, message.to); // logs SENT / DELIVERED / FAILED as the phone reports it
    return { providerMessageId: String(id) };
  }

  /** Reads the phone's own report for this SMS until it is final or the watch time runs out. */
  async watchDelivery(smsId: number, to: string): Promise<string> {
    const end = Date.now() + (this.config.statusWatchMs ?? 120_000);
    let last = 'PENDING';
    while (Date.now() < end) {
      await new Promise((r) => setTimeout(r, this.config.statusPollMs ?? 5_000));
      try {
        const r = await this.call(`/api/status?sms_id=${smsId}`, { method: 'GET' });
        const status = r.body.status ?? 'UNKNOWN';
        if (status !== last) {
          last = status;
          const line = `SMS ${smsId} to ${maskPhone(to)}: ${status}${r.body.error_message ? ` (${r.body.error_message})` : ''} — reported by the gateway phone`;
          if (status === 'FAILED') this.logger.warn(line);
          else this.logger.log(line);
        }
        if (FINAL.has(status)) return status;
      } catch {
        // phone briefly unreachable: keep trying until the watch ends
      }
    }
    this.logger.warn(
      `SMS ${smsId} to ${maskPhone(to)}: no delivery report within the watch time (last: ${last}) — NOT confirmed`,
    );
    return last;
  }

  private async call(
    path: string,
    init: RequestInit,
  ): Promise<{ ok: boolean; status: number; body: GatewayReply }> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', 'X-API-Key': this.config.apiKey },
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new SmsDeliveryError(`Gateway phone unreachable: ${reason}`, this.name);
    }
    const body = (await response.json().catch(() => ({}))) as GatewayReply;
    return { ok: response.ok, status: response.status, body };
  }
}
