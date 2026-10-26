import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module.js';
import { DispatchModule } from '../dispatch/dispatch.module.js';
import { LocationsModule } from '../locations/locations.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { VehiclesModule } from '../vehicles/vehicles.module.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';
import { BookingStatusHistory } from './entities/booking-status-history.entity.js';
import { Booking } from './entities/booking.entity.js';
import { QuotesService } from './quotes.service.js';
import { TrackingService } from './tracking.service.js';

/** Tow jobs: quotes, booking, status history and the customer's live trip view. */
@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, BookingStatusHistory]),
    VehiclesModule,
    LocationsModule,
    PricingModule,
    AuditModule,
    DispatchModule,
    PaymentsModule,
  ],
  controllers: [BookingsController],
  providers: [QuotesService, BookingsService, TrackingService],
  exports: [TypeOrmModule, BookingsService],
})
export class BookingsModule {}
