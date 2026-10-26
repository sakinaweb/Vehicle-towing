import { AuditModule } from '../audit/audit.module.js';
import { AdminPricingController } from './admin-pricing.controller.js';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PricingRule } from './entities/pricing-rule.entity.js';
import { PricingController } from './pricing.controller.js';
import { PricingService } from './pricing.service.js';

/** Versioned tariffs and fare calculation (fils, 5% UAE VAT). */
@Module({
  imports: [TypeOrmModule.forFeature([PricingRule]), AuditModule],
  controllers: [PricingController, AdminPricingController],
  providers: [PricingService],
  exports: [TypeOrmModule, PricingService],
})
export class PricingModule {}
