import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfigService } from '../../config/app-config.service.js';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/** Shared Redis connection for caching, rate limits, presence and health checks. */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const logger = new Logger('Redis');
        const client = new Redis({
          ...config.redis,
          lazyConnect: false,
          maxRetriesPerRequest: 3,
          connectionName: 'townow-api',
        });
        client.on('error', (err: Error) => logger.error(`Redis error: ${err.message}`));
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
