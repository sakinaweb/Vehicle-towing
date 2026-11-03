import { Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { SmsProviderName } from '../../config/env.validation.js';
import { AndroidGatewaySmsProvider } from './android-gateway-sms.provider.js';
import { FallbackSmsProvider } from './fallback-sms.provider.js';
import { InfobipSmsProvider } from './infobip-sms.provider.js';
import { LogSmsProvider } from './log-sms.provider.js';
import { SMS_PROVIDER, SmsProvider } from './sms-provider.js';
import { infobipCallbackToken, SmsStatusController } from './sms-status.controller.js';
import { TwilioSmsProvider } from './twilio-sms.provider.js';
import { OTP_VERIFIER, OtpVerifier, TwilioVerifyClient } from './twilio-verify.client.js';

/** A provider that sends our own code. Presence of its credentials is enforced by env validation. */
function buildSender(name: SmsProviderName, config: AppConfigService): SmsProvider | null {
  const { twilio, infobip, androidGateway, statusCallbackBaseUrl: base } = config.sms;
  switch (name) {
    case SmsProviderName.Twilio:
      return new TwilioSmsProvider({
        accountSid: twilio.accountSid!,
        authToken: twilio.authToken!,
        sender: twilio.sender!,
        statusCallbackUrl: base && `${base}/sms/status/twilio`,
      });
    case SmsProviderName.Infobip:
      return new InfobipSmsProvider({
        baseUrl: infobip.baseUrl!,
        apiKey: infobip.apiKey!,
        sender: infobip.sender!,
        notifyUrl: base && `${base}/sms/status/infobip/${infobipCallbackToken(config.otp.secret)}`,
      });
    case SmsProviderName.AndroidGateway:
      return new AndroidGatewaySmsProvider({
        baseUrl: androidGateway.baseUrl!,
        apiKey: androidGateway.apiKey!,
      });
    case SmsProviderName.Log:
      return new LogSmsProvider();
    case SmsProviderName.TwilioVerify:
      return null; // Twilio Verify sends its own SMS (OTP_VERIFIER)
  }
}

/**
 * SMS_PROVIDER: the sender for our own codes — the primary, wrapped with SMS_BACKUP_PROVIDER
 * when set. With twilio_verify it is just the backup (or null): OtpService falls back to it when
 * Verify cannot send. OTP_VERIFIER: Twilio Verify, when it is the primary.
 */
@Module({
  controllers: [SmsStatusController],
  providers: [
    {
      provide: SMS_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): SmsProvider | null => {
        const { provider, backupProvider } = config.sms;
        const primary = buildSender(provider, config);
        const backup = backupProvider ? buildSender(backupProvider, config) : null;
        return primary && backup ? new FallbackSmsProvider(primary, backup) : (primary ?? backup);
      },
    },
    {
      provide: OTP_VERIFIER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): OtpVerifier | null => {
        const { provider, twilioVerify } = config.sms;
        if (provider !== SmsProviderName.TwilioVerify) return null;
        return new TwilioVerifyClient({
          apiKeySid: twilioVerify.apiKeySid!,
          apiKeySecret: twilioVerify.apiKeySecret!,
          serviceSid: twilioVerify.serviceSid!,
          baseUrl: twilioVerify.baseUrl,
        });
      },
    },
  ],
  exports: [SMS_PROVIDER, OTP_VERIFIER],
})
export class SmsModule {}
