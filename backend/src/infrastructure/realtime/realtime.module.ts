import { Module } from '@nestjs/common';
import { AuditModule } from '../../modules/audit/audit.module.js';
import { AuthModule } from '../../modules/auth/auth.module.js';
import { DispatchModule } from '../../modules/dispatch/dispatch.module.js';
import { RealtimeGateway } from './realtime.gateway.js';

@Module({
  imports: [AuthModule, DispatchModule, AuditModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
