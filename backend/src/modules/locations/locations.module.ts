import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SavedLocation } from './entities/saved-location.entity.js';
import { ServiceZone } from './entities/service-zone.entity.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { EtaService } from './eta.service.js';
import { GeocodingService, LocationsController } from './geocoding.js';
import { RoutingService } from './routing.service.js';

/** Saved places, service zones and geospatial queries (PostGIS). */
@Module({
  imports: [TypeOrmModule.forFeature([SavedLocation, ServiceZone])],
  controllers: [LocationsController],
  providers: [
    {
      provide: GeocodingService,
      inject: [AppConfigService],
      useFactory: (c: AppConfigService) => new GeocodingService(c),
    },
    RoutingService,
    {
      provide: EtaService,
      inject: [AppConfigService],
      useFactory: (c: AppConfigService) => new EtaService(c),
    },
  ],
  exports: [TypeOrmModule, RoutingService, EtaService],
})
export class LocationsModule {}
