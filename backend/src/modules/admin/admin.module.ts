import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { BookingsModule } from '../bookings/bookings.module.js';
import { DispatchModule } from '../dispatch/dispatch.module.js';
import { AdminInsightsController } from './admin-insights.controller.js';
import { AdminKycService } from './admin-kyc.service.js';
import { AdminOpsController } from './admin-ops.controller.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminController } from './admin.controller.js';

/** Operations console endpoints (built on the other modules; no tables of its own). */
@Module({
  imports: [AuditModule, AuthModule, DispatchModule, BookingsModule],
  controllers: [AdminController, AdminOpsController, AdminInsightsController, AdminUsersController],
  providers: [AdminKycService],
})
export class AdminModule {}
