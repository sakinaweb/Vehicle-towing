/** Injection token for the configured SMS provider. */
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface SmsMessage {
  /** E.164 recipient, e.g. +971501234567. */
  to: string;
  body: string;
}

export interface SmsSendResult {
  /** Provider's message id, for delivery tracing and support. */
  providerMessageId: string;
}

/**
 * Anything that can deliver an SMS. Implementations must throw SmsDeliveryError
 * when the provider refuses or cannot be reached, and must never log the body
 * in production (it may contain a passcode).
 */
export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<SmsSendResult>;
}

export class SmsDeliveryError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    /** Provider error code when available (e.g. Twilio 21211 = invalid number). */
    readonly providerCode?: string | number,
  ) {
    super(message);
    this.name = 'SmsDeliveryError';
  }
}
