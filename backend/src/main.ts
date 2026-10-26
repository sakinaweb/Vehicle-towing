import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { startWorkers } from './infrastructure/queue/start-workers.js';
import { AppConfigService } from './config/app-config.service.js';

async function bootstrap(): Promise<void> {
  // rawBody: payment webhooks are verified against the exact bytes received.
  const app = await NestFactory.create(AppModule, { bufferLogs: false, rawBody: true });
  configureApp(app);
  app.enableShutdownHooks();

  const config = app.get(AppConfigService);
  const { port, apiPrefix, swaggerEnabled, env } = config.app;
  await app.listen(port);
  // Production runs workers in their own container (worker.ts) and sets RUN_WORKERS=false here.
  if (config.runWorkers) startWorkers(app);

  const logger = new Logger('Bootstrap');
  logger.log(`TowNow API (${env}) listening on http://localhost:${port}/${apiPrefix}`);
  if (swaggerEnabled) logger.log(`OpenAPI docs: http://localhost:${port}/${apiPrefix}/docs`);
}

void bootstrap();
