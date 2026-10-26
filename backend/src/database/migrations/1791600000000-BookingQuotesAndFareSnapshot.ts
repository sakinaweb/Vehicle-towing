import { MigrationInterface, QueryRunner } from 'typeorm';

export class BookingQuotesAndFareSnapshot1791600000000 implements MigrationInterface {
  name = 'BookingQuotesAndFareSnapshot1791600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Customer-facing booking numbers: TN-100001, TN-100002, … (gaps on rollback are fine).
    await queryRunner.query(`CREATE SEQUENCE IF NOT EXISTS "booking_number_seq" START WITH 100001`);
    await queryRunner.query(`
            ALTER TABLE "bookings"
            ADD "vat_rate_bps" integer NOT NULL
        `);
    await queryRunner.query(`
            ALTER TABLE "bookings"
            ADD "fare_snapshot" jsonb NOT NULL
        `);
    await queryRunner.query(`
            ALTER TABLE "bookings"
            ADD "quote_id" uuid NOT NULL
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_bookings_quote" ON "bookings" ("quote_id")
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_bookings_active_vehicle" ON "bookings" ("customer_vehicle_id")
            WHERE "status" NOT IN ('completed', 'cancelled')
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."uq_bookings_active_vehicle"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."uq_bookings_quote"
        `);
    await queryRunner.query(`
            ALTER TABLE "bookings" DROP COLUMN "quote_id"
        `);
    await queryRunner.query(`
            ALTER TABLE "bookings" DROP COLUMN "fare_snapshot"
        `);
    await queryRunner.query(`
            ALTER TABLE "bookings" DROP COLUMN "vat_rate_bps"
        `);
    await queryRunner.query(`DROP SEQUENCE IF EXISTS "booking_number_seq"`);
  }
}
