import { defineConfig } from 'vitest/config';

// End-to-end tests: boot the real app against PostgreSQL/PostGIS and Redis (docker compose up -d).
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    // Real environment variables override .env, isolating tests from a running dev API:
    // own Redis DB (rate limits, denylist) and own queue prefix.
    env: {
      NODE_ENV: 'test',
      REDIS_DB: '1',
      QUEUE_PREFIX: 'townow-e2e',
      OTP_IP_HOURLY_LIMIT: '1000',
      CORS_ORIGINS: 'http://localhost:3000',
      // Short dispatch timers so matching tests run in seconds.
      MATCHING_OFFER_TIMEOUT_SECONDS: '2',
      MATCHING_RETRY_DELAY_SECONDS: '1',
      MATCHING_SEARCH_RADIUS_METERS: '15000',
      DRIVER_LOCATION_MAX_AGE_SECONDS: '120',
      DRIVER_LOCATION_DB_WRITE_INTERVAL_SECONDS: '0',
      // Uploaded test files go to a throwaway folder.
      STORAGE_PROVIDER: 'local',
      STORAGE_LOCAL_DIR: './.e2e-storage',
      ROUTING_PROVIDER: 'none',
      // Never reach a real SMS/Verify provider from tests, whatever .env says.
      SMS_PROVIDER: 'log',
    },
  },
});
