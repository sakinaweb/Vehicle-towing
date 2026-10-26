import { INestApplicationContext, Logger } from '@nestjs/common';
import { BullRegistrar } from '@nestjs/bullmq';

/** Starts every BullMQ worker (matching, payments, notifications, system) in this process. */
export function startWorkers(app: INestApplicationContext): void {
  app.get(BullRegistrar).register();
  new Logger('Workers').log('BullMQ workers started');
}
