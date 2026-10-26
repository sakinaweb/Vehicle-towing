import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { HttpAdapterHost } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { AppConfigService } from './config/app-config.service.js';
import type { Redis } from 'ioredis';
import { CorsIoAdapter } from './infrastructure/realtime/cors-io.adapter.js';
import { socketIoKey } from './infrastructure/realtime/realtime.emitter.js';
import { REDIS_CLIENT } from './infrastructure/redis/redis.module.js';

/** HTTP pipeline shared by main.ts and the e2e tests, so tests exercise the real setup. */
export function configureApp(app: INestApplication): void {
  const config = app.get(AppConfigService);
  const { apiPrefix, corsOrigins, swaggerEnabled } = config.app;

  // Behind a load balancer, trust N proxy hops so req.ip is the real client (used by rate limits).
  (app as NestExpressApplication).set('trust proxy', config.trustProxyHops);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.useWebSocketAdapter(
    new CorsIoAdapter(app, corsOrigins, {
      client: app.get<Redis>(REDIS_CLIENT),
      key: socketIoKey(config.queuePrefix),
    }),
  );

  // Routes: /api/v1/<resource>; version-neutral routes (health) live at /api/<resource>.
  app.setGlobalPrefix(apiPrefix);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties
      forbidNonWhitelisted: true, // …and reject requests that send them
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
  app.enableShutdownHooks();

  if (swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('TowNow API')
        .setDescription('UAE on-demand towing and roadside assistance marketplace')
        .setVersion('1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
      jsonDocumentUrl: `${apiPrefix}/docs-json`,
    });
  }
}
