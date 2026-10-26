import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { DriversModule } from './drivers/drivers.module.js';
import { VehiclesModule } from './vehicles/vehicles.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { LocationsModule } from './locations/locations.module.js';
import { PricingModule } from './pricing/pricing.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { ChatModule } from './chat/chat.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AdminModule } from './admin/admin.module.js';
import { DispatchModule } from './dispatch/dispatch.module.js';
import { SupportModule } from './support/support.module.js';

/** All TowNow domain modules (modular monolith boundaries). */
export const DOMAIN_MODULES = [
  AuthModule,
  UsersModule,
  CustomersModule,
  DriversModule,
  VehiclesModule,
  BookingsModule,
  LocationsModule,
  PricingModule,
  PaymentsModule,
  NotificationsModule,
  ChatModule,
  AuditModule,
  AdminModule,
  DispatchModule,
  SupportModule,
];
