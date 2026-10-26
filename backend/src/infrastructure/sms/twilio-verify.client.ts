import { Logger } from '@nestjs/common';
import { maskPhone } from '../../common/phone.js';
import { SmsDeliveryError } from './sms-provider.js';

/** Injection token: set when Twilio Verify issues and checks codes (SMS_PROVIDER=twilio_verify). */
export const OTP_VERIFIER = Symbol('OTP_VERIFIER');

export type OtpCheckResult =
  /** Correct code; Twilio has consumed the verification. */
  | 'approved'
  /** Wrong code; the verification is still pending. */
  | 'incorrect'
  /** No pending verification: expired, already approved, or Twilio's own attempt limit hit. */
  | 'expired'
  /** Twilio's check-attempt limit (60202). */
  | 'too_many_attempts';

/** An external service that sends and checks one-time codes itself. */
export interface OtpVerifier {
  readonly name: string;
  start(phone: string): Promise<void>;
  check(phone: string, code: string): Promise<OtpCheckResult>;
}

export interface TwilioVerifyConfig {
  apiKeySid: string;
  apiKeySecret: string;
  serviceSid: string;
  /** https://verify.twilio.com — overridable for tests. */
  baseUrl: string;
  timeoutMs?: number;
}

interface TwilioErrorBody {
  code?: number;
  message?: string;
  status?: string;
  valid?: boolean;
}

/**
 * Twilio Verify v2 over its REST API (no SDK, same approach as TwilioSmsProvider).
 * Authenticates with an API key; codes and secrets are never logged.
 */
export class TwilioVerifyClient implements OtpVerifier {
  readonly name = 'twilio_verify';
  private readonly logger = new Logger('OTP:twilio_verify');

  constructor(
    private readonly config: TwilioVerifyConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Asks Twilio to send a code by SMS. Throws SmsDeliveryError when Twilio refuses. */
  async start(phone: string): Promise<void> {
    const { status, body } = await this.post('Verifications', { To: phone, Channel: 'sms' });
    if (status >= 200 && status < 300) return;
    this.logger.error(
      `Verify refused to send to ${maskPhone(phone)}: HTTP ${status} code=${body.code ?? 'n/a'} ${body.message ?? ''}`,
    );
    throw new SmsDeliveryError(
      body.message ?? `Twilio Verify HTTP ${status}`,
      this.name,
      body.code,
    );
  }

  async check(phone: string, code: string): Promise<OtpCheckResult> {
    const { status, body } = await this.post('VerificationCheck', { To: phone, Code: code });
    if (status === 200) return body.status === 'approved' ? 'approved' : 'incorrect';
    // Twilio deletes the verification once expired, approved or out of attempts.
    if (status === 404) return 'expired';
    if (status === 429 && body.code === 60202) return 'too_many_attempts';
    this.logger.error(
      `Verify check for ${maskPhone(phone)} failed: HTTP ${status} code=${body.code ?? 'n/a'} ${body.message ?? ''}`,
    );
    throw new SmsDeliveryError(
      body.message ?? `Twilio Verify HTTP ${status}`,
      this.name,
      body.code,
    );
  }

  private async post(
    resource: 'Verifications' | 'VerificationCheck',
    fields: Record<string, string>,
  ): Promise<{ status: number; body: TwilioErrorBody }> {
    const { apiKeySid, apiKeySecret, serviceSid, baseUrl } = this.config;
    const url = `${baseUrl}/v2/Services/${encodeURIComponent(serviceSid)}/${resource}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${apiKeySid}:${apiKeySecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(fields),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new SmsDeliveryError(`Twilio Verify unreachable: ${reason}`, this.name);
    }
    const body = (await response.json().catch(() => ({}))) as TwilioErrorBody;
    return { status: response.status, body };
  }
}
