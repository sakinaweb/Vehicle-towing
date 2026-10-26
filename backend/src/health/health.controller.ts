import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { Public } from '../modules/auth/decorators.js';
import { InfraHealthIndicators } from './infra.health.js';

@Public()
@ApiTags('Health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly infra: InfraHealthIndicators,
  ) {}

  /** Liveness: the process is up. Never touches dependencies, so a DB outage doesn't restart pods. */
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ schema: { example: { status: 'ok' } } })
  live() {
    return { status: 'ok' };
  }

  /** Readiness: every dependency the API needs is reachable. */
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe (PostgreSQL, PostGIS, Redis, BullMQ)' })
  @ApiServiceUnavailableResponse({ description: 'At least one dependency is down' })
  ready() {
    return this.health.check([
      () => this.db.pingCheck('database', { timeout: 3000 }),
      () => this.infra.postgis(),
      () => this.infra.redisPing(),
      () => this.infra.queue(),
    ]);
  }
}
