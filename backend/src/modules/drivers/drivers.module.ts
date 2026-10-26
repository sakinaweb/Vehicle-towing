import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module.js';
import { DriverDocumentsService } from './driver-documents.service.js';
import { DriversController } from './drivers.controller.js';
import { DriversService } from './drivers.service.js';
import { DriverDocument } from './entities/driver-document.entity.js';
import { Driver } from './entities/driver.entity.js';
import { TowTruck } from './entities/tow-truck.entity.js';

/** Driver partners (tow operators), their tow trucks and KYC documents. */
@Module({
  imports: [TypeOrmModule.forFeature([Driver, TowTruck, DriverDocument]), AuditModule],
  controllers: [DriversController],
  providers: [DriversService, DriverDocumentsService],
  exports: [TypeOrmModule],
})
export class DriversModule {}
