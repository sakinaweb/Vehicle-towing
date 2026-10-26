import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module.js';
import { Dispute } from './entities/dispute.entity.js';
import { SupportController } from './support.controller.js';

/** Disputes about jobs (customer/driver → operations). */
@Module({
  imports: [TypeOrmModule.forFeature([Dispute]), AuditModule],
  controllers: [SupportController],
  exports: [TypeOrmModule],
})
export class SupportModule {}
