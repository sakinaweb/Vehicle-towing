import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables, NodeEnv } from './env.validation.js';

/** Typed, read-only access to validated configuration. */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

  private get<K extends keyof EnvironmentVariables>(key: K): EnvironmentVariables[K] {
    return this.config.get(key, { infer: true });
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === NodeEnv.Production;
  }

  get app() {
    return {
      env: this.get('NODE_ENV'),
      port: this.get('PORT'),
      apiPrefix: this.get('API_PREFIX'),
      corsOrigins: this.get('CORS_ORIGINS')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
      swaggerEnabled: this.get('SWAGGER_ENABLED'),
    };
  }

  get database() {
    return {
      host: this.get('DATABASE_HOST'),
      port: this.get('DATABASE_PORT'),
      username: this.get('DATABASE_USER'),
      password: this.get('DATABASE_PASSWORD'),
      database: this.get('DATABASE_NAME'),
      ssl: this.get('DATABASE_SSL'),
      logging: this.get('DATABASE_LOGGING'),
    };
  }

  get redis() {
    return {
      host: this.get('REDIS_HOST'),
      port: this.get('REDIS_PORT'),
      password: this.get('REDIS_PASSWORD') || undefined,
      db: this.get('REDIS_DB'),
    };
  }

  get trustProxyHops(): number {
    return this.get('TRUST_PROXY');
  }

  get queuePrefix(): string {
    return this.get('QUEUE_PREFIX');
  }

  get auth() {
    return {
      accessSecret: this.get('JWT_ACCESS_SECRET'),
      accessTtlSeconds: this.get('JWT_ACCESS_TTL_SECONDS'),
      refreshTtlDays: this.get('REFRESH_TOKEN_TTL_DAYS'),
      cookieSecure: this.get('COOKIE_SECURE'),
    };
  }

  get otp() {
    return {
      secret: this.get('OTP_SECRET'),
      ttlSeconds: this.get('OTP_TTL_SECONDS'),
      maxAttempts: this.get('OTP_MAX_ATTEMPTS'),
      resendCooldownSeconds: this.get('OTP_RESEND_COOLDOWN_SECONDS'),
      phoneHourlyLimit: this.get('OTP_PHONE_HOURLY_LIMIT'),
      ipHourlyLimit: this.get('OTP_IP_HOURLY_LIMIT'),
      devAllowIndiaPhones: this.get('DEV_ALLOW_INDIA_PHONES'),
      countries: this.get('OTP_COUNTRIES'),
      demoPhones: this.get('DEMO_LOGIN_PHONES'),
      demoCode: this.get('DEMO_LOGIN_CODE'),
    };
  }

  get matching() {
    return {
      searchRadiusMeters: this.get('MATCHING_SEARCH_RADIUS_METERS'),
      offerTimeoutSeconds: this.get('MATCHING_OFFER_TIMEOUT_SECONDS'),
      retryDelaySeconds: this.get('MATCHING_RETRY_DELAY_SECONDS'),
      maxSearchSeconds: this.get('MATCHING_MAX_SEARCH_SECONDS'),
      locationMaxAgeSeconds: this.get('DRIVER_LOCATION_MAX_AGE_SECONDS'),
      locationDbWriteIntervalSeconds: this.get('DRIVER_LOCATION_DB_WRITE_INTERVAL_SECONDS'),
      staleOfflineSeconds: this.get('DRIVER_STALE_OFFLINE_SECONDS'),
    };
  }

  get storage() {
    return {
      provider: this.get('STORAGE_PROVIDER'),
      localDir: this.get('STORAGE_LOCAL_DIR'),
      s3: {
        bucket: this.get('S3_BUCKET'),
        region: this.get('S3_REGION'),
        endpoint: this.get('S3_ENDPOINT') || undefined,
        accessKeyId: this.get('S3_ACCESS_KEY_ID'),
        secretAccessKey: this.get('S3_SECRET_ACCESS_KEY'),
        forcePathStyle: this.get('S3_FORCE_PATH_STYLE'),
      },
    };
  }

  get payments() {
    return {
      provider: this.get('PAYMENT_PROVIDER'),
      stripe: {
        secretKey: this.get('STRIPE_SECRET_KEY'),
        publishableKey: this.get('STRIPE_PUBLISHABLE_KEY'),
        webhookSecret: this.get('STRIPE_WEBHOOK_SECRET'),
        apiBase: this.get('STRIPE_API_BASE'),
      },
      authTimeoutMinutes: this.get('PAYMENT_AUTH_TIMEOUT_MINUTES'),
    };
  }

  get invoice() {
    return {
      sellerName: this.get('INVOICE_SELLER_NAME'),
      sellerAddress: this.get('INVOICE_SELLER_ADDRESS') ?? null,
      trn: this.get('INVOICE_TRN') ?? null,
    };
  }

  get push() {
    return {
      provider: this.get('PUSH_PROVIDER'),
      fcm: {
        projectId: this.get('FCM_PROJECT_ID'),
        clientEmail: this.get('FCM_CLIENT_EMAIL'),
        privateKey: this.get('FCM_PRIVATE_KEY')?.replace(/\\n/g, '\n'),
        apiBase: this.get('FCM_API_BASE'),
        tokenUri: this.get('FCM_TOKEN_URI'),
      },
    };
  }

  get runWorkers(): boolean {
    return this.get('RUN_WORKERS');
  }

  get routing() {
    return {
      provider: this.get('ROUTING_PROVIDER'),
      googleApiKey: this.get('GOOGLE_MAPS_API_KEY'),
      mapboxToken: this.get('MAPBOX_ACCESS_TOKEN'),
    };
  }

  get sms() {
    return {
      provider: this.get('SMS_PROVIDER'),
      backupProvider: this.get('SMS_BACKUP_PROVIDER'),
      statusCallbackBaseUrl: this.get('SMS_STATUS_CALLBACK_BASE_URL'),
      infobip: {
        baseUrl: this.get('INFOBIP_BASE_URL'),
        apiKey: this.get('INFOBIP_API_KEY'),
        sender: this.get('INFOBIP_SENDER'),
      },
      androidGateway: {
        baseUrl: this.get('ANDROID_GATEWAY_URL'),
        apiKey: this.get('ANDROID_GATEWAY_API_KEY'),
      },
      twilio: {
        accountSid: this.get('TWILIO_ACCOUNT_SID'),
        authToken: this.get('TWILIO_AUTH_TOKEN'),
        sender: this.get('TWILIO_SENDER'),
      },
      twilioVerify: {
        accountSid: this.get('TWILIO_ACCOUNT_SID'),
        apiKeySid: this.get('TWILIO_API_KEY_SID'),
        apiKeySecret: this.get('TWILIO_API_KEY_SECRET'),
        serviceSid: this.get('TWILIO_VERIFY_SERVICE_SID'),
        baseUrl: this.get('TWILIO_VERIFY_BASE_URL'),
      },
    };
  }
}
