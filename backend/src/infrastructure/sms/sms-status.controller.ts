import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { maskPhone } from '../../common/phone.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { Public } from '../../modules/auth/decorators.js';

const safeEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Twilio request signature: base64 HMAC-SHA1 of the URL + sorted key/value pairs. */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>) {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac('sha1', authToken).update(data).digest('base64');
}

/** Secret path segment for Infobip reports (Infobip does not sign its callbacks). */
export const infobipCallbackToken = (otpSecret: string) =>
  createHmac('sha256', otpSecret).update('sms-status:infobip').digest('hex').slice(0, 32);

const FAILED = new Set(['failed', 'undelivered', 'REJECTED', 'UNDELIVERABLE', 'EXPIRED']);

/**
 * Delivery reports from the SMS providers. Only logged (masked number, status, error code), so
 * carrier-side failures — e.g. an unregistered UAE sender ID — are visible in the API log.
 */
@ApiExcludeController()
@Public()
@Controller('sms/status')
export class SmsStatusController {
  private readonly logger = new Logger('SMS:status');

  constructor(private readonly config: AppConfigService) {}

  @Post('twilio')
  @HttpCode(HttpStatus.NO_CONTENT)
  twilio(
    @Headers('x-twilio-signature') signature: string | undefined,
    @Body() body: Record<string, string>,
  ): void {
    const { statusCallbackBaseUrl: base, twilio } = this.config.sms;
    if (!base || !twilio.authToken) throw new NotFoundException();
    const expected = twilioSignature(twilio.authToken, `${base}/sms/status/twilio`, body);
    if (!signature || !safeEqual(signature, expected)) throw new ForbiddenException();
    this.report('twilio', body.MessageSid, body.To, body.MessageStatus, body.ErrorCode);
  }

  @Post('infobip/:token')
  @HttpCode(HttpStatus.NO_CONTENT)
  infobip(
    @Param('token') token: string,
    @Body()
    body: {
      results?: {
        messageId?: string;
        to?: string;
        status?: { groupName?: string; name?: string };
        error?: { name?: string };
      }[];
    },
  ): void {
    if (!this.config.sms.statusCallbackBaseUrl) throw new NotFoundException();
    if (!safeEqual(token, infobipCallbackToken(this.config.otp.secret))) {
      throw new ForbiddenException();
    }
    for (const r of body.results ?? []) {
      const error = r.error?.name && r.error.name !== 'NO_ERROR' ? r.error.name : undefined;
      this.report('infobip', r.messageId, r.to && `+${r.to}`, r.status?.groupName, error);
    }
  }

  private report(provider: string, id?: string, to?: string, status?: string, error?: string) {
    const line = `${provider} ${id ?? '?'} to ${to ? maskPhone(to) : '?'}: ${status ?? '?'}${error ? ` error=${error}` : ''}`;
    if (status && FAILED.has(status)) this.logger.warn(line);
    else this.logger.log(line);
  }
}
