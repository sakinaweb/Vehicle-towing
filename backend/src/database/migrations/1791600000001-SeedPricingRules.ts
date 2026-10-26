import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Launch tariffs (reference data, not demo data). Values come from the TowNow
 * pricing rules already presented to customers:
 *
 *   tow type      base     per km   minimum   tow-type surcharge   night (00–06)   VAT
 *   flatbed       150.00   4.80     150.00    50.00                35.00           5%
 *   wheel-lift    120.00   4.80     150.00     0.00                35.00           5%
 *   bike-carrier  120.00   4.80     150.00     0.00                35.00           5%
 *
 * Amounts are fils, rates basis points. To change prices, insert a new row with a
 * later effective_from (and set effective_to on the old one) — never edit a rule
 * that bookings already reference; bookings keep their own fare snapshot anyway.
 */
const EFFECTIVE_FROM = '2026-01-01T00:00:00+04:00';
const RULES: [towType: string, baseFils: number, surchargeFils: number][] = [
  ['flatbed', 15_000, 5_000],
  ['wheel-lift', 12_000, 0],
  ['bike-carrier', 12_000, 0],
];

export class SeedPricingRules1791600000001 implements MigrationInterface {
  name = 'SeedPricingRules1791600000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [towType, baseFils, surchargeFils] of RULES) {
      await queryRunner.query(
        `INSERT INTO "pricing_rules"
           ("tow_type", "base_fare_fils", "per_km_fils", "minimum_fare_fils",
            "tow_type_surcharge_fils", "night_surcharge_fils", "vat_rate_bps",
            "platform_commission_bps", "currency", "effective_from", "is_active")
         SELECT $1::tow_type, $2, 480, 15000, $3, 3500, 500, 2000, 'AED', $4::timestamptz, true
         WHERE NOT EXISTS (
           SELECT 1 FROM "pricing_rules" WHERE "tow_type" = $1::tow_type AND "effective_from" = $4::timestamptz
         )`,
        [towType, baseFils, surchargeFils, EFFECTIVE_FROM],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only remove the launch tariffs if no booking references them.
    await queryRunner.query(
      `DELETE FROM "pricing_rules" r
       WHERE r."effective_from" = $1::timestamptz
         AND NOT EXISTS (SELECT 1 FROM "bookings" b WHERE b."pricing_rule_id" = r."id")`,
      [EFFECTIVE_FROM],
    );
  }
}
