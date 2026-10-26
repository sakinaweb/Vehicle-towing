import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { QueueModule } from './infrastructure/queue/queue.module.js';
import { RealtimeEmitterModule } from './infrastructure/realtime/realtime.emitter.js';
import { StorageModule } from './infrastructure/storage/storage.module.js';
import { RealtimeModule } from './infrastructure/realtime/realtime.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { DOMAIN_MODULES } from './modules/index.js';

@Module({
  imports: [
    // Infrastructure
    AppConfigModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    RealtimeEmitterModule,
    StorageModule,
    RealtimeModule,
    HealthModule,
    // Domain (modular monolith: each module owns its tables)
    ...DOMAIN_MODULES,
  ],
})
export class AppModule {}
