import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { REDIS_CLIENT } from '../infrastructure/redis/redis.module.js';
import { SYSTEM_QUEUE } from '../infrastructure/queue/queue.constants.js';

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** A readiness probe must answer quickly even when a dependency hangs (e.g. Redis reconnecting). */
export const CHECK_TIMEOUT_MS = 3000;

export function withTimeout<T>(promise: Promise<T>, ms = CHECK_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Readiness checks for PostGIS, Redis and BullMQ (Postgres itself uses Terminus' TypeORM check). */
@Injectable()
export class InfraHealthIndicators {
  constructor(
    private readonly health: HealthIndicatorService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectQueue(SYSTEM_QUEUE) private readonly systemQueue: Queue,
  ) {}

  async postgis() {
    const indicator = this.health.check('postgis');
    try {
      const rows: { version: string }[] = await withTimeout(
        this.dataSource.query('SELECT postgis_lib_version() AS version'),
      );
      return indicator.up({ version: rows[0]?.version });
    } catch (err) {
      return indicator.down({ message: errorMessage(err) });
    }
  }

  async redisPing() {
    const indicator = this.health.check('redis');
    try {
      // ping() resolves with "PONG" or rejects, so reaching here means Redis answered.
      await withTimeout(this.redis.ping());
      return indicator.up();
    } catch (err) {
      return indicator.down({ message: errorMessage(err) });
    }
  }

  async queue() {
    const indicator = this.health.check('queue');
    try {
      const counts = await withTimeout(
        this.systemQueue.getJobCounts('waiting', 'active', 'failed'),
      );
      return indicator.up({ queue: SYSTEM_QUEUE, ...counts });
    } catch (err) {
      return indicator.down({ message: errorMessage(err) });
    }
  }
}
