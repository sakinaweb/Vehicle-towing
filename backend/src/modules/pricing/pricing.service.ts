import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { TowType } from '../../common/enums.js';
import { PricingRule } from './entities/pricing-rule.entity.js';
import { calculateFare, FareBreakdown } from './fare.calculator.js';

export class TariffView {
  @ApiProperty({ enum: TowType }) towType!: TowType;
  @ApiProperty({ description: 'Hook-up fare, fils' }) baseFareFils!: number;
  @ApiProperty({ description: 'Per kilometre, fils' }) perKmFils!: number;
  @ApiProperty() minimumFareFils!: number;
  @ApiProperty() towTypeSurchargeFils!: number;
  @ApiProperty({ description: 'Applied 00:00–05:59 UAE time' }) nightSurchargeFils!: number;
  @ApiProperty({ description: '500 = 5% VAT' }) vatRateBps!: number;
  @ApiProperty({ example: 'AED' }) currency!: string;

  static from(rule: PricingRule): TariffView {
    return {
      towType: rule.towType,
      baseFareFils: rule.baseFareFils,
      perKmFils: rule.perKmFils,
      minimumFareFils: rule.minimumFareFils,
      towTypeSurchargeFils: rule.towTypeSurchargeFils,
      nightSurchargeFils: rule.nightSurchargeFils,
      vatRateBps: rule.vatRateBps,
      currency: rule.currency,
    };
  }
}

export interface PricedTrip {
  rule: PricingRule;
  fare: FareBreakdown;
}

@Injectable()
export class PricingService {
  constructor(@InjectRepository(PricingRule) private readonly rules: Repository<PricingRule>) {}

  /** The tariff in force for a tow type at a moment (newest active version wins). */
  async activeRule(towType: TowType, at: Date = new Date()): Promise<PricingRule> {
    const rule = await this.rules.findOne({
      where: [
        { towType, isActive: true, effectiveFrom: LessThanOrEqual(at), effectiveTo: IsNull() },
        { towType, isActive: true, effectiveFrom: LessThanOrEqual(at), effectiveTo: MoreThan(at) },
      ],
      order: { effectiveFrom: 'DESC' },
    });
    if (!rule) {
      throw new ServiceUnavailableException(`${towType} towing is not available right now.`);
    }
    return rule;
  }

  async activeTariffs(at: Date = new Date()): Promise<TariffView[]> {
    const tariffs: TariffView[] = [];
    for (const towType of Object.values(TowType)) {
      const rule = await this.activeRule(towType, at).catch(() => null);
      if (rule) tariffs.push(TariffView.from(rule));
    }
    return tariffs;
  }

  async price(
    towType: TowType,
    distanceMeters: number,
    at: Date = new Date(),
  ): Promise<PricedTrip> {
    const rule = await this.activeRule(towType, at);
    return { rule, fare: calculateFare(rule, distanceMeters, at) };
  }
}
