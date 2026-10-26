import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { moneyColumn } from '../../../common/entities/column-types.js';
import { TowType } from '../../../common/enums.js';

/**
 * Versioned tariff per tow type. Bookings snapshot the computed fare, so editing
 * a rule never changes historical invoices. Money in fils, rates in basis points.
 */
@Entity('pricing_rules')
@Index('ix_pricing_rules_lookup', ['towType', 'isActive', 'effectiveFrom'])
export class PricingRule extends BaseEntity {
  @Column({ type: 'enum', enum: TowType, enumName: 'tow_type' })
  towType!: TowType;

  @Column(moneyColumn())
  baseFareFils!: number;

  @Column(moneyColumn())
  perKmFils!: number;

  @Column(moneyColumn())
  minimumFareFils!: number;

  @Column(moneyColumn({ default: 0 }))
  towTypeSurchargeFils!: number;

  @Column(moneyColumn({ default: 0 }))
  nightSurchargeFils!: number;

  /** UAE VAT; 500 bps = 5%. */
  @Column({ type: 'integer', default: 500 })
  vatRateBps!: number;

  /** Marketplace commission taken from the driver payout; 2000 bps = 20%. */
  @Column({ type: 'integer', default: 2000 })
  platformCommissionBps!: number;

  @Column({ type: 'char', length: 3, default: 'AED' })
  currency!: string;

  @Column({ type: 'timestamptz' })
  effectiveFrom!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  effectiveTo!: Date | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}
