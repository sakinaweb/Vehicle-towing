import 'reflect-metadata';
import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum SmsProviderName {
  Log = 'log',
  Twilio = 'twilio',
  /** Twilio Verify: Twilio generates, sends and checks the code. */
  TwilioVerify = 'twilio_verify',
}

export enum StorageProviderName {
  Local = 'local',
  S3 = 's3',
}

export enum RoutingProviderName {
  None = 'none',
  Google = 'google',
  Mapbox = 'mapbox',
}

export enum PaymentProviderName {
  /** Card / Apple Pay bookings are refused; cash only. */
  None = 'none',
  Stripe = 'stripe',
}

export enum PushProviderName {
  /** Notifications go to the in-app inbox and sockets only (no FCM). */
  None = 'none',
  Fcm = 'fcm',
}

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/**
 * Reads the raw value: implicit conversion would turn the string "false" into true.
 * Unset values keep the class default.
 */
const toBoolean = ({
  obj,
  key,
  value,
}: {
  obj: Record<string, unknown>;
  key: string;
  value: unknown;
}) => {
  const raw = obj[key];
  if (raw === undefined || raw === '') return value;
  return raw === true || raw === 'true' || raw === '1';
};

/**
 * Every environment variable the API reads. The app refuses to start if any
 * required value is missing or malformed, so misconfiguration fails fast.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 4000;

  @IsString()
  API_PREFIX: string = 'api';

  /** Comma-separated list of allowed browser origins. */
  @IsString()
  CORS_ORIGINS: string = 'http://localhost:3000';

  @Transform(toBoolean)
  @IsBoolean()
  SWAGGER_ENABLED: boolean = true;

  /** Number of reverse-proxy hops in front of the API (0 when exposed directly). */
  @IsInt()
  @Min(0)
  @Max(5)
  TRUST_PROXY: number = 0;

  @IsString()
  @IsNotEmpty()
  DATABASE_HOST!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  DATABASE_PORT: number = 5432;

  @IsString()
  @IsNotEmpty()
  DATABASE_USER!: string;

  @IsString()
  @IsNotEmpty()
  DATABASE_PASSWORD!: string;

  @IsString()
  @IsNotEmpty()
  DATABASE_NAME!: string;

  @Transform(toBoolean)
  @IsBoolean()
  DATABASE_SSL: boolean = false;

  @Transform(toBoolean)
  @IsBoolean()
  DATABASE_LOGGING: boolean = false;

  @IsString()
  @IsNotEmpty()
  REDIS_HOST!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT: number = 6379;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  @IsInt()
  @Min(0)
  @Max(15)
  REDIS_DB: number = 0;

  /** Key prefix for BullMQ queues, so several environments can share one Redis. */
  @IsString()
  QUEUE_PREFIX: string = 'townow';

  // ---- Authentication ----

  /** HMAC secret for access tokens (HS256). Generate with: openssl rand -base64 48 */
  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET!: string;

  @IsInt()
  @Min(60)
  @Max(3600)
  JWT_ACCESS_TTL_SECONDS: number = 900;

  @IsInt()
  @Min(1)
  @Max(180)
  REFRESH_TOKEN_TTL_DAYS: number = 30;

  /** Send auth cookies only over HTTPS. Must be true in production. */
  @Transform(toBoolean)
  @IsBoolean()
  COOKIE_SECURE: boolean = false;

  // ---- One-time passcodes ----

  /** Pepper for hashing OTP codes, so a database leak does not reveal live codes. */
  @IsString()
  @MinLength(32)
  OTP_SECRET!: string;

  @IsInt()
  @Min(60)
  @Max(900)
  OTP_TTL_SECONDS: number = 300;

  @IsInt()
  @Min(1)
  @Max(10)
  OTP_MAX_ATTEMPTS: number = 5;

  @IsInt()
  @Min(0)
  @Max(600)
  OTP_RESEND_COOLDOWN_SECONDS: number = 30;

  /** Max OTP requests per phone number per hour (SMS-pumping / abuse protection). */
  @IsInt()
  @Min(1)
  OTP_PHONE_HOURLY_LIMIT: number = 5;

  /** Max OTP requests per client IP per hour. */
  @IsInt()
  @Min(1)
  OTP_IP_HOURLY_LIMIT: number = 30;

  /**
   * Development only: also sign in Indian (+91) mobile numbers, for testers without a UAE SIM.
   * Refused in production and with any SMS provider except "log" (codes only go to the API log).
   */
  @Transform(toBoolean)
  @IsBoolean()
  DEV_ALLOW_INDIA_PHONES: boolean = false;

  // ---- SMS delivery ----

  /**
   * "log" prints messages to the server log (development only); "twilio" sends our own code via
   * Programmable Messaging; "twilio_verify" lets Twilio Verify issue and check the code.
   */
  @IsEnum(SmsProviderName)
  SMS_PROVIDER: SmsProviderName = SmsProviderName.Log;

  @IsOptional()
  @IsString()
  TWILIO_ACCOUNT_SID?: string;

  @IsOptional()
  @IsString()
  TWILIO_AUTH_TOKEN?: string;

  /** Registered sender: an E.164 number, alphanumeric sender ID, or Messaging Service SID (MG…). */
  @IsOptional()
  @IsString()
  TWILIO_SENDER?: string;

  // Twilio Verify (SMS_PROVIDER=twilio_verify). API key auth — the Auth Token is not needed.
  @IsOptional()
  @Matches(/^SK[0-9a-fA-F]{32}$/, {
    message: 'TWILIO_API_KEY_SID must look like SK + 32 hex characters',
  })
  TWILIO_API_KEY_SID?: string;

  @IsOptional()
  @IsString()
  TWILIO_API_KEY_SECRET?: string;

  @IsOptional()
  @Matches(/^VA[0-9a-fA-F]{32}$/, {
    message: 'TWILIO_VERIFY_SERVICE_SID must look like VA + 32 hex characters',
  })
  TWILIO_VERIFY_SERVICE_SID?: string;

  /** Override only for tests (a local fake Verify API). */
  @IsString()
  TWILIO_VERIFY_BASE_URL: string = 'https://verify.twilio.com';

  // ---- Dispatch / matching ----

  /** Only drivers within this distance of the pickup are offered the job. */
  @IsInt()
  @Min(500)
  @Max(100_000)
  MATCHING_SEARCH_RADIUS_METERS: number = 15_000;

  /** How long a driver has to accept an offer before it goes to the next driver. */
  @IsInt()
  @Min(1)
  @Max(300)
  MATCHING_OFFER_TIMEOUT_SECONDS: number = 30;

  /** Wait before searching again when no eligible driver is nearby. */
  @IsInt()
  @Min(1)
  @Max(600)
  MATCHING_RETRY_DELAY_SECONDS: number = 20;

  /** Give up (and cancel with "no tow truck available") after searching this long. */
  @IsInt()
  @Min(60)
  @Max(7200)
  MATCHING_MAX_SEARCH_SECONDS: number = 900;

  /** A driver's location older than this is considered stale (not offered jobs, rejected on upload). */
  @IsInt()
  @Min(10)
  @Max(3600)
  DRIVER_LOCATION_MAX_AGE_SECONDS: number = 120;

  /** Minimum seconds between PostgreSQL writes of one driver's position (Redis gets every fix). */
  @IsInt()
  @Min(0)
  @Max(60)
  DRIVER_LOCATION_DB_WRITE_INTERVAL_SECONDS: number = 15;

  /** An online driver (not on a job) whose GPS has been stale this long is set offline; 0 = never. */
  @IsInt()
  @Min(0)
  @Max(86400)
  DRIVER_STALE_OFFLINE_SECONDS: number = 600;

  // ---- File storage (inspection photos, KYC documents) ----

  /** "local" writes to disk (development only); "s3" uses any S3-compatible store (AWS S3, R2, MinIO). */
  @IsEnum(StorageProviderName)
  STORAGE_PROVIDER: StorageProviderName = StorageProviderName.Local;

  @IsString()
  STORAGE_LOCAL_DIR: string = './storage';

  @IsOptional() @IsString() S3_BUCKET?: string;
  @IsOptional() @IsString() S3_REGION?: string;
  /** Custom endpoint for S3-compatible stores (R2, MinIO); empty for AWS. */
  @IsOptional() @IsString() S3_ENDPOINT?: string;
  @IsOptional() @IsString() S3_ACCESS_KEY_ID?: string;
  @IsOptional() @IsString() S3_SECRET_ACCESS_KEY?: string;
  @Transform(toBoolean)
  @IsBoolean()
  S3_FORCE_PATH_STYLE: boolean = false;

  // ---- Routing / ETA ----

  /** "none" = ETA reported as unavailable (never faked); "google" or "mapbox" = real road ETA. */
  @IsEnum(RoutingProviderName)
  ROUTING_PROVIDER: RoutingProviderName = RoutingProviderName.None;

  @IsOptional() @IsString() GOOGLE_MAPS_API_KEY?: string;
  @IsOptional() @IsString() MAPBOX_ACCESS_TOKEN?: string;

  // ---- Payments ----

  /** "none" = cash only; "stripe" = card / Apple Pay, authorised at booking, captured on completion. */
  @IsEnum(PaymentProviderName)
  PAYMENT_PROVIDER: PaymentProviderName = PaymentProviderName.None;

  @IsOptional() @IsString() STRIPE_SECRET_KEY?: string;
  /** Public key for Stripe.js in the apps (safe to expose). */
  @IsOptional() @IsString() STRIPE_PUBLISHABLE_KEY?: string;
  /** Signing secret of the webhook endpoint (whsec_…). */
  @IsOptional() @IsString() STRIPE_WEBHOOK_SECRET?: string;

  /** Override only for tests (a local fake Stripe). */
  @IsString()
  STRIPE_API_BASE: string = 'https://api.stripe.com';

  /** An unpaid card booking is cancelled after this many minutes (frees the vehicle). */
  @IsInt()
  @Min(5)
  @Max(1440)
  PAYMENT_AUTH_TIMEOUT_MINUTES: number = 30;

  // ---- Invoices ----

  @IsString()
  INVOICE_SELLER_NAME: string = 'TowNow';

  @IsOptional() @IsString() INVOICE_SELLER_ADDRESS?: string;

  /**
   * UAE Tax Registration Number (15 digits). Until it is set, documents are issued as
   * receipts marked "not a tax invoice" — required before issuing production tax invoices.
   */
  @IsOptional()
  @Matches(/^\d{15}$/, { message: 'INVOICE_TRN must be the 15-digit UAE Tax Registration Number' })
  INVOICE_TRN?: string;

  // ---- Push notifications (Firebase Cloud Messaging, HTTP v1) ----

  @IsEnum(PushProviderName)
  PUSH_PROVIDER: PushProviderName = PushProviderName.None;

  /** From the Firebase service-account JSON: project_id, client_email, private_key. */
  @IsOptional() @IsString() FCM_PROJECT_ID?: string;
  @IsOptional() @IsString() FCM_CLIENT_EMAIL?: string;
  /** PEM; "\n" escapes are accepted (single-line .env values). */
  @IsOptional() @IsString() FCM_PRIVATE_KEY?: string;

  /** Overrides only for tests (a local fake FCM). */
  @IsString() FCM_API_BASE: string = 'https://fcm.googleapis.com';
  @IsString() FCM_TOKEN_URI: string = 'https://oauth2.googleapis.com/token';

  // ---- Process role ----

  /**
   * Whether this process runs the BullMQ workers (matching, payments, notifications).
   * Production runs the API with false and a separate worker container (dist/worker.js).
   */
  @Transform(toBoolean)
  @IsBoolean()
  RUN_WORKERS: boolean = true;
}

/** Rules that only make sense across several variables, or only in production. */
function crossFieldErrors(env: EnvironmentVariables): string[] {
  const errors: string[] = [];
  if (env.DEV_ALLOW_INDIA_PHONES && env.SMS_PROVIDER !== SmsProviderName.Log) {
    errors.push('DEV_ALLOW_INDIA_PHONES requires SMS_PROVIDER=log');
  }
  if (env.SMS_PROVIDER === SmsProviderName.Twilio) {
    for (const key of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_SENDER'] as const) {
      if (!env[key]) errors.push(`${key} is required when SMS_PROVIDER=twilio`);
    }
  }
  if (env.PAYMENT_PROVIDER === PaymentProviderName.Stripe) {
    for (const key of [
      'STRIPE_SECRET_KEY',
      'STRIPE_PUBLISHABLE_KEY',
      'STRIPE_WEBHOOK_SECRET',
    ] as const) {
      if (!env[key]) errors.push(`${key} is required when PAYMENT_PROVIDER=stripe`);
    }
    if (env.NODE_ENV !== NodeEnv.Production && env.STRIPE_SECRET_KEY?.startsWith('sk_live_')) {
      errors.push(
        'A live Stripe key is not allowed outside production; use a test key (sk_test_…)',
      );
    }
  }
  if (env.PUSH_PROVIDER === PushProviderName.Fcm) {
    for (const key of ['FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY'] as const) {
      if (!env[key]) errors.push(`${key} is required when PUSH_PROVIDER=fcm`);
    }
  }
  if (env.SMS_PROVIDER === SmsProviderName.TwilioVerify) {
    for (const key of [
      'TWILIO_ACCOUNT_SID',
      'TWILIO_API_KEY_SID',
      'TWILIO_API_KEY_SECRET',
      'TWILIO_VERIFY_SERVICE_SID',
    ] as const) {
      if (!env[key]) errors.push(`${key} is required when SMS_PROVIDER=twilio_verify`);
    }
    if (env.TWILIO_ACCOUNT_SID && !/^AC[0-9a-fA-F]{32}$/.test(env.TWILIO_ACCOUNT_SID)) {
      errors.push('TWILIO_ACCOUNT_SID must look like AC + 32 hex characters');
    }
  }
  if (env.STORAGE_PROVIDER === StorageProviderName.S3) {
    for (const key of [
      'S3_BUCKET',
      'S3_REGION',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    ] as const) {
      if (!env[key]) errors.push(`${key} is required when STORAGE_PROVIDER=s3`);
    }
  }
  if (env.ROUTING_PROVIDER === RoutingProviderName.Google && !env.GOOGLE_MAPS_API_KEY) {
    errors.push('GOOGLE_MAPS_API_KEY is required when ROUTING_PROVIDER=google');
  }
  if (env.ROUTING_PROVIDER === RoutingProviderName.Mapbox && !env.MAPBOX_ACCESS_TOKEN) {
    errors.push('MAPBOX_ACCESS_TOKEN is required when ROUTING_PROVIDER=mapbox');
  }
  if (env.NODE_ENV === NodeEnv.Production) {
    if (env.STORAGE_PROVIDER === StorageProviderName.Local) {
      errors.push(
        'STORAGE_PROVIDER=local is not allowed in production (files would live on one server)',
      );
    }
    if (env.DATABASE_PASSWORD === 'change-me') {
      errors.push('DATABASE_PASSWORD must be changed in production');
    }
    for (const key of ['JWT_ACCESS_SECRET', 'OTP_SECRET'] as const) {
      if (env[key].includes('change-me')) errors.push(`${key} must be changed in production`);
    }
    if (env.SMS_PROVIDER === SmsProviderName.Log) {
      errors.push('SMS_PROVIDER=log is not allowed in production (codes would only be logged)');
    }
    if (!env.COOKIE_SECURE) errors.push('COOKIE_SECURE must be true in production');
    if (env.DEV_ALLOW_INDIA_PHONES)
      errors.push('DEV_ALLOW_INDIA_PHONES is not allowed in production');
  }
  return errors;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('; ');
    throw new Error(`Invalid environment configuration — ${details}`);
  }
  const crossErrors = crossFieldErrors(validated);
  if (crossErrors.length > 0) {
    throw new Error(`Invalid environment configuration — ${crossErrors.join('; ')}`);
  }
  return validated;
}
