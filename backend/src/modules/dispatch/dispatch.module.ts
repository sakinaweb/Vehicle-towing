import { NearbyController } from './nearby.controller.js';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MATCHING_QUEUE } from './dispatch.constants.js';
import { DispatchController } from './dispatch.controller.js';
import { DriverAvailabilityService } from './driver-availability.service.js';
import { DriverLocationService } from './driver-location.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { BookingInspection } from './entities/booking-inspection.entity.js';
import { BookingOffer } from './entities/booking-offer.entity.js';
import { InspectionPhoto } from './entities/inspection-photo.entity.js';
import { InspectionsService } from './inspections.service.js';
import { MatchingProcessor } from './matching.processor.js';
import { MatchingService } from './matching.service.js';

/** Driver availability, live location, automatic matching, the trip lifecycle and inspections. */
@Module({
  imports: [
    TypeOrmModule.forFeature([BookingOffer, BookingInspection, InspectionPhoto]),
    AuditModule,
    PaymentsModule,
    BullModule.registerQueue({ name: MATCHING_QUEUE }),
  ],
  controllers: [DispatchController, NearbyController],
  providers: [
    MatchingService,
    DriverAvailabilityService,
    DriverLocationService,
    MatchingProcessor,
    InspectionsService,
  ],
  exports: [TypeOrmModule, MatchingService, DriverLocationService, InspectionsService],
})
export class DispatchModule {}
