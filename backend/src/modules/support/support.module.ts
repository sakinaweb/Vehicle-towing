import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module.js';
import { Dispute } from './entities/dispute.entity.js';
import { SosAlert } from './entities/sos-alert.entity.js';
import { SosController } from './sos.controller.js';
import { SupportController } from './support.controller.js';

/** Disputes about jobs and SOS alerts (customer/driver → operations). */
@Module({
  imports: [TypeOrmModule.forFeature([Dispute, SosAlert]), AuditModule],
  controllers: [SupportController, SosController],
  exports: [TypeOrmModule],
})
export class SupportModule {}
