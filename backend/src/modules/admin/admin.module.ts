import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { BookingsModule } from '../bookings/bookings.module.js';
import { DispatchModule } from '../dispatch/dispatch.module.js';
import { AdminKycService } from './admin-kyc.service.js';
import { AdminOpsController } from './admin-ops.controller.js';
import { AdminController } from './admin.controller.js';

/** Operations console endpoints (built on the other modules; no tables of its own). */
@Module({
  imports: [AuditModule, DispatchModule, BookingsModule],
  controllers: [AdminController, AdminOpsController],
  providers: [AdminKycService],
})
export class AdminModule {}
