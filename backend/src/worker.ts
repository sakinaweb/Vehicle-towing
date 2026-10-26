import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Emitter } from '@socket.io/redis-emitter';
import type { Redis } from 'ioredis';
import { AppModule } from './app.module.js';
import { AppConfigService } from './config/app-config.service.js';
import { startWorkers } from './infrastructure/queue/start-workers.js';
import { RealtimeEmitter, socketIoKey } from './infrastructure/realtime/realtime.emitter.js';
import { REDIS_CLIENT } from './infrastructure/redis/redis.module.js';

/**
 * BullMQ worker process (matching, offer timeouts, payments, push). No HTTP port.
 * Socket events it raises reach clients through the API's Redis adapter.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  const config = app.get(AppConfigService);
  const redis = app.get<Redis>(REDIS_CLIENT);
  app
    .get(RealtimeEmitter)
    .attach(new Emitter(redis, { key: socketIoKey(config.queuePrefix) }).of('/realtime'));
  startWorkers(app);
  new Logger('Bootstrap').log(`TowNow worker (${config.app.env}) running`);
}

void bootstrap();
