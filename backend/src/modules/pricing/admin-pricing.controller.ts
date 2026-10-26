import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { IsEnum, IsInt, Max, Min } from 'class-validator';
import { DataSource, IsNull } from 'typeorm';
import { TowType, UserRole } from '../../common/enums.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, Roles } from '../auth/decorators.js';
import { PricingRule } from './entities/pricing-rule.entity.js';
import { TariffView } from './pricing.service.js';

export class PublishTariffDto {
  @ApiProperty({ enum: TowType }) @IsEnum(TowType) towType!: TowType;
  @ApiProperty() @IsInt() @Min(0) @Max(1_000_000) baseFareFils!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100_000) perKmFils!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(1_000_000) minimumFareFils!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(1_000_000) towTypeSurchargeFils!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(1_000_000) nightSurchargeFils!: number;
  @ApiProperty({ description: '2000 = 20%' })
  @IsInt()
  @Min(0)
  @Max(5000)
  platformCommissionBps!: number;
}

export class TariffVersionView extends TariffView {
  @ApiProperty() id!: string;
  @ApiProperty() platformCommissionBps!: number;
  @ApiProperty() effectiveFrom!: Date;
  @ApiProperty({ nullable: true, type: Date }) effectiveTo!: Date | null;
}

const versionView = (r: PricingRule): TariffVersionView => ({
  ...TariffView.from(r),
  id: r.id,
  platformCommissionBps: r.platformCommissionBps,
  effectiveFrom: r.effectiveFrom,
  effectiveTo: r.effectiveTo,
});

/**
 * Fare configuration. Tariffs are versioned, never edited in place: existing quotes and
 * bookings keep the version they were priced with. VAT is not configurable here.
 */
@ApiTags('Admin · Pricing')
@ApiBearerAuth()
@Roles(UserRole.Admin)
@Controller('admin/pricing-rules')
export class AdminPricingController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'All tariff versions, newest first' })
  @ApiOkResponse({ type: [TariffVersionView] })
  async list(): Promise<TariffVersionView[]> {
    const rules = await this.dataSource.manager.find(PricingRule, {
      order: { effectiveFrom: 'DESC' },
      take: 100,
    });
    return rules.map(versionView);
  }

  @Post()
  @ApiOperation({ summary: 'Publish a new tariff for a tow type, effective immediately' })
  @ApiCreatedResponse({ type: TariffVersionView })
  async publish(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: PublishTariffDto,
  ): Promise<TariffVersionView> {
    const rule = await this.dataSource.transaction(async (em) => {
      const open = await em.find(PricingRule, {
        where: { towType: dto.towType, isActive: true, effectiveTo: IsNull() },
        order: { effectiveFrom: 'DESC' },
        lock: { mode: 'pessimistic_write' },
      });
      const now = new Date();
      if (open.length > 0) {
        await em.update(
          PricingRule,
          open.map((r) => r.id),
          { effectiveTo: now },
        );
      }
      return em.save(
        em.create(PricingRule, {
          ...dto,
          vatRateBps: open[0]?.vatRateBps ?? 500,
          currency: 'AED',
          effectiveFrom: now,
          effectiveTo: null,
          isActive: true,
        }),
      );
    });
    await this.audit.record({
      action: 'pricing.published',
      entityType: 'pricing_rule',
      entityId: rule.id,
      actorUserId: auth.userId,
      metadata: { ...dto },
    });
    return versionView(rule);
  }
}
