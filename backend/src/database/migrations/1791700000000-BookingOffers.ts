import { MigrationInterface, QueryRunner } from 'typeorm';

export class BookingOffers1791700000000 implements MigrationInterface {
  name = 'BookingOffers1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TYPE "public"."offer_status" AS ENUM(
                'pending',
                'accepted',
                'declined',
                'expired',
                'cancelled'
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "booking_offers" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "booking_id" uuid NOT NULL,
                "driver_id" uuid NOT NULL,
                "tow_truck_id" uuid NOT NULL,
                "status" "public"."offer_status" NOT NULL DEFAULT 'pending',
                "distance_to_pickup_meters" integer NOT NULL,
                "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "responded_at" TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "PK_c000e2973cb4b9fe685c6469ec4" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_booking_offers_driver_created" ON "booking_offers" ("driver_id", "created_at")
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_booking_offers_booking_driver" ON "booking_offers" ("booking_id", "driver_id")
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_booking_offers_pending_driver" ON "booking_offers" ("driver_id")
            WHERE "status" = 'pending'
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_booking_offers_pending_booking" ON "booking_offers" ("booking_id")
            WHERE "status" = 'pending'
        `);
    await queryRunner.query(`
            ALTER TABLE "booking_offers"
            ADD CONSTRAINT "FK_40f53606cf1ed2070c66e5fb761" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "booking_offers"
            ADD CONSTRAINT "FK_08b17a83083eb50fdd3da80156a" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "booking_offers"
            ADD CONSTRAINT "FK_e6af4ccceb93ecaeb3b24e8f1ec" FOREIGN KEY ("tow_truck_id") REFERENCES "tow_trucks"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "booking_offers" DROP CONSTRAINT "FK_e6af4ccceb93ecaeb3b24e8f1ec"
        `);
    await queryRunner.query(`
            ALTER TABLE "booking_offers" DROP CONSTRAINT "FK_08b17a83083eb50fdd3da80156a"
        `);
    await queryRunner.query(`
            ALTER TABLE "booking_offers" DROP CONSTRAINT "FK_40f53606cf1ed2070c66e5fb761"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."uq_booking_offers_pending_booking"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."uq_booking_offers_pending_driver"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."uq_booking_offers_booking_driver"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_booking_offers_driver_created"
        `);
    await queryRunner.query(`
            DROP TABLE "booking_offers"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."offer_status"
        `);
  }
}
