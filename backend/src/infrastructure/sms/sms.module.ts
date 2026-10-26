import { Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { SmsProviderName } from '../../config/env.validation.js';
import { LogSmsProvider } from './log-sms.provider.js';
import { SMS_PROVIDER, SmsProvider } from './sms-provider.js';
import { TwilioSmsProvider } from './twilio-sms.provider.js';
import { OTP_VERIFIER, OtpVerifier, TwilioVerifyClient } from './twilio-verify.client.js';

/**
 * Provides the SmsProvider selected by SMS_PROVIDER, and — for twilio_verify — the
 * OtpVerifier that issues and checks codes instead of our own hash. Add new providers here.
 */
@Module({
  providers: [
    {
      provide: SMS_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): SmsProvider => {
        const { provider, twilio } = config.sms;
        switch (provider) {
          case SmsProviderName.Twilio:
            // Presence of these values is enforced by env validation.
            return new TwilioSmsProvider({
              accountSid: twilio.accountSid!,
              authToken: twilio.authToken!,
              sender: twilio.sender!,
            });
          case SmsProviderName.Log:
          case SmsProviderName.TwilioVerify:
            // With Verify, OtpService never sends its own SMS; this is only a placeholder.
            return new LogSmsProvider();
        }
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
