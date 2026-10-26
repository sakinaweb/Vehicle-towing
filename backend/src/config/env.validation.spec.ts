import { NodeEnv, validateEnv } from './env.validation.js';

const base = {
  DATABASE_HOST: 'localhost',
  DATABASE_USER: 'townow',
  DATABASE_PASSWORD: 'secret',
  DATABASE_NAME: 'townow',
  REDIS_HOST: 'localhost',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  OTP_SECRET: 'b'.repeat(48),
};

/** A production configuration that satisfies every production-only rule. */
const prod = {
  ...base,
  NODE_ENV: 'production',
  COOKIE_SECURE: 'true',
  SMS_PROVIDER: 'twilio',
  TWILIO_ACCOUNT_SID: 'AC123',
  TWILIO_AUTH_TOKEN: 'token',
  TWILIO_SENDER: 'TowNow',
  STORAGE_PROVIDER: 's3',
  S3_BUCKET: 'townow-files',
  S3_REGION: 'me-central-1',
  S3_ACCESS_KEY_ID: 'AKIA123',
  S3_SECRET_ACCESS_KEY: 'secret',
};

describe('validateEnv', () => {
  it('applies defaults for optional values', () => {
    const env = validateEnv(base);
    expect(env.NODE_ENV).toBe(NodeEnv.Development);
    expect(env.PORT).toBe(4000);
    expect(env.DATABASE_PORT).toBe(5432);
    expect(env.SWAGGER_ENABLED).toBe(true);
    expect(env.DATABASE_SSL).toBe(false);
  });

  it('converts numeric strings to numbers', () => {
    const env = validateEnv({ ...base, PORT: '8080', DATABASE_PORT: '5433', REDIS_DB: '2' });
    expect(env.PORT).toBe(8080);
    expect(env.DATABASE_PORT).toBe(5433);
    expect(env.REDIS_DB).toBe(2);
  });

  it('parses the string "false" as false (not truthy)', () => {
    const env = validateEnv({ ...base, DATABASE_SSL: 'false', SWAGGER_ENABLED: 'false' });
    expect(env.DATABASE_SSL).toBe(false);
    expect(env.SWAGGER_ENABLED).toBe(false);
  });

  it('parses "true" and "1" as true', () => {
    const env = validateEnv({ ...base, DATABASE_SSL: 'true', DATABASE_LOGGING: '1' });
    expect(env.DATABASE_SSL).toBe(true);
    expect(env.DATABASE_LOGGING).toBe(true);
  });

  it('rejects missing required values', () => {
    const withoutHost: Record<string, unknown> = { ...base };
    delete withoutHost.DATABASE_HOST;
    expect(() => validateEnv(withoutHost)).toThrow(/DATABASE_HOST/);
  });

  it('rejects out-of-range ports', () => {
    expect(() => validateEnv({ ...base, PORT: '70000' })).toThrow(/PORT/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'staging-ish' })).toThrow(/NODE_ENV/);
  });

  it('accepts a complete production configuration', () => {
    expect(validateEnv(prod).NODE_ENV).toBe(NodeEnv.Production);
  });

  it('refuses the placeholder database password in production', () => {
    expect(() => validateEnv({ ...prod, DATABASE_PASSWORD: 'change-me' })).toThrow(
      /DATABASE_PASSWORD/,
    );
  });

  it('requires auth secrets of at least 32 characters', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
    const withoutOtpSecret: Record<string, unknown> = { ...base };
    delete withoutOtpSecret.OTP_SECRET;
    expect(() => validateEnv(withoutOtpSecret)).toThrow(/OTP_SECRET/);
  });

  it('refuses placeholder secrets in production', () => {
    expect(() => validateEnv({ ...prod, OTP_SECRET: 'change-me-'.repeat(4) })).toThrow(
      /OTP_SECRET/,
    );
  });

  it('refuses local file storage in production and needs S3 credentials for s3', () => {
    expect(() => validateEnv({ ...prod, STORAGE_PROVIDER: 'local' })).toThrow(
      /STORAGE_PROVIDER=local/,
    );
    expect(() => validateEnv({ ...base, STORAGE_PROVIDER: 's3' })).toThrow(/S3_BUCKET is required/);
    expect(validateEnv(base).STORAGE_PROVIDER).toBe('local');
  });

  it('needs the key of the routing provider it is told to use', () => {
    expect(validateEnv(base).ROUTING_PROVIDER).toBe('none');
    expect(() => validateEnv({ ...base, ROUTING_PROVIDER: 'google' })).toThrow(
      /GOOGLE_MAPS_API_KEY/,
    );
    expect(() => validateEnv({ ...base, ROUTING_PROVIDER: 'mapbox' })).toThrow(
      /MAPBOX_ACCESS_TOKEN/,
    );
    expect(
      validateEnv({ ...base, ROUTING_PROVIDER: 'google', GOOGLE_MAPS_API_KEY: 'k' })
        .ROUTING_PROVIDER,
    ).toBe('google');
  });

  it('refuses the log SMS provider in production', () => {
    expect(() => validateEnv({ ...prod, SMS_PROVIDER: 'log' })).toThrow(/SMS_PROVIDER=log/);
  });

  it('allows Indian test numbers only in development with the log SMS provider', () => {
    expect(validateEnv(base).DEV_ALLOW_INDIA_PHONES).toBe(false);
    expect(validateEnv({ ...base, DEV_ALLOW_INDIA_PHONES: 'true' }).DEV_ALLOW_INDIA_PHONES).toBe(
      true,
    );
    expect(() => validateEnv({ ...prod, DEV_ALLOW_INDIA_PHONES: 'true' })).toThrow(
      /DEV_ALLOW_INDIA_PHONES is not allowed in production/,
    );
    expect(() =>
      validateEnv({ ...prod, NODE_ENV: 'development', DEV_ALLOW_INDIA_PHONES: 'true' }),
    ).toThrow(/DEV_ALLOW_INDIA_PHONES requires SMS_PROVIDER=log/);
  });

  it('requires secure cookies in production', () => {
    expect(() => validateEnv({ ...prod, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
  });

  it('requires Twilio credentials when Twilio is selected', () => {
    expect(() => validateEnv({ ...base, SMS_PROVIDER: 'twilio' })).toThrow(/TWILIO_ACCOUNT_SID/);
  });

  it('requires all Twilio Verify settings, in the right format, when Verify is selected', () => {
    const verify = {
      ...base,
      SMS_PROVIDER: 'twilio_verify',
      TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32),
      TWILIO_API_KEY_SID: 'SK' + 'b'.repeat(32),
      TWILIO_API_KEY_SECRET: 'test-secret',
      TWILIO_VERIFY_SERVICE_SID: 'VA' + 'c'.repeat(32),
    };
    expect(validateEnv(verify).SMS_PROVIDER).toBe('twilio_verify');
    expect(() => validateEnv({ ...verify, TWILIO_API_KEY_SECRET: undefined })).toThrow(
      /TWILIO_API_KEY_SECRET is required/,
    );
    expect(() => validateEnv({ ...verify, TWILIO_VERIFY_SERVICE_SID: 'VA123' })).toThrow(
      /TWILIO_VERIFY_SERVICE_SID/,
    );
    expect(() => validateEnv({ ...verify, TWILIO_API_KEY_SID: 'AC' + 'b'.repeat(32) })).toThrow(
      /TWILIO_API_KEY_SID/,
    );
    expect(() => validateEnv({ ...verify, TWILIO_ACCOUNT_SID: 'XX' })).toThrow(
      /TWILIO_ACCOUNT_SID must look like/,
    );
    // Verify is a real provider, so it is allowed in production (log is not).
    expect(
      validateEnv({ ...prod, ...verify, NODE_ENV: 'production', TWILIO_SENDER: undefined })
        .SMS_PROVIDER,
    ).toBe('twilio_verify');
  });

  it('defaults to the development log provider and sane OTP limits', () => {
    const env = validateEnv(base);
    expect(env.SMS_PROVIDER).toBe('log');
    expect(env.OTP_TTL_SECONDS).toBe(300);
    expect(env.OTP_MAX_ATTEMPTS).toBe(5);
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
  });
});
