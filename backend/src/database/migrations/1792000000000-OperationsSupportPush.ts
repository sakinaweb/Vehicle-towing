import { MigrationInterface, QueryRunner } from 'typeorm';

export class OperationsSupportPush1792000000000 implements MigrationInterface {
  name = 'OperationsSupportPush1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TYPE "public"."device_platform" AS ENUM('android', 'ios', 'web')
        `);
    await queryRunner.query(`
            CREATE TABLE "device_tokens" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "user_id" uuid NOT NULL,
                "token" character varying(512) NOT NULL,
                "platform" "public"."device_platform" NOT NULL,
                "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_84700be257607cfb1f9dc2e52c3" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_device_tokens_token" ON "device_tokens" ("token")
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_device_tokens_user" ON "device_tokens" ("user_id")
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."dispute_status" AS ENUM('open', 'resolved', 'rejected')
        `);
    await queryRunner.query(`
            CREATE TABLE "disputes" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "booking_id" uuid NOT NULL,
                "raised_by_id" uuid NOT NULL,
                "raised_by_role" "public"."user_role" NOT NULL,
                "reason" character varying(1000) NOT NULL,
                "status" "public"."dispute_status" NOT NULL DEFAULT 'open',
                "resolution" character varying(1000),
                "resolved_by_id" uuid,
                "resolved_at" TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "PK_3c97580d01c1a4b0b345c42a107" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_disputes_open_booking" ON "disputes" ("booking_id")
            WHERE "status" = 'open'
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_disputes_status_created" ON "disputes" ("status", "created_at")
        `);
    await queryRunner.query(`
            ALTER TABLE "bookings"
            ADD "customer_rating" smallint
        `);
    await queryRunner.query(`
            ALTER TABLE "bookings"
            ADD "customer_review" character varying(500)
        `);
    await queryRunner.query(`
            ALTER TABLE "bookings"
            ADD "rated_at" TIMESTAMP WITH TIME ZONE
        `);
    await queryRunner.query(`
            ALTER TABLE "driver_ledger_entries"
            ADD "reference" character varying(80)
        `);
    await queryRunner.query(`
            ALTER TABLE "driver_ledger_entries" DROP CONSTRAINT "FK_450876f32fffcb5a1bea270a613"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."uq_driver_ledger_booking_type"
        `);
    await queryRunner.query(`
            ALTER TABLE "driver_ledger_entries"
            ALTER COLUMN "booking_id" DROP NOT NULL
        `);
    await queryRunner.query(`
            ALTER TYPE "public"."ledger_entry_type"
            ADD VALUE 'remittance'
        `);
    await queryRunner.query(`
            ALTER TYPE "public"."ledger_entry_type"
            ADD VALUE 'payout'
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_driver_ledger_reference" ON "driver_ledger_entries" ("reference")
            WHERE "reference" IS NOT NULL
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_driver_ledger_booking_type" ON "driver_ledger_entries" ("booking_id", "type")
        `);
    await queryRunner.query(`
            ALTER TABLE "device_tokens"
            ADD CONSTRAINT "FK_17e1f528b993c6d55def4cf5bea" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "driver_ledger_entries"
            ADD CONSTRAINT "FK_450876f32fffcb5a1bea270a613" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "disputes"
            ADD CONSTRAINT "FK_722d6e06d51e51095ef73df20d4" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "disputes"
            ADD CONSTRAINT "FK_1e8426bb7937fd68804813287d2" FOREIGN KEY ("raised_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "disputes"
            ADD CONSTRAINT "FK_46a6bddc5b940e568033271437a" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "disputes" DROP CONSTRAINT "FK_46a6bddc5b940e568033271437a"
        `);
    await queryRunner.query(`
            ALTER TABLE "disputes" DROP CONSTRAINT "FK_1e8426bb7937fd68804813287d2"
        `);
    await queryRunner.query(`
            ALTER TABLE "disputes" DROP CONSTRAINT "FK_722d6e06d51e51095ef73df20d4"
        `);
    await queryRunner.query(`
            ALTER TABLE "driver_ledger_entries" DROP CONSTRAINT "FK_450876f32fffcb5a1bea270a613"
        `);
    await queryRunner.query(`
            ALTER TABLE "device_tokens" DROP CONSTRAINT "FK_17e1f528b993c6d55def4cf5bea"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."uq_driver_ledger_booking_type"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."uq_driver_ledger_reference"
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."ledger_entry_type_old" AS ENUM('trip_earning', 'cash_collected')
        `);
    await queryRunner.query(`
            ALTER TABLE "driver_ledger_entries"
            ALTER COLUMN "type" TYPE "public"."ledger_entry_type_old" USING "type"::"text"::"public"."ledger_entry_type_old"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."ledger_entry_type"
        `);
    await queryRunner.query(`
            ALTER TYPE "public"."ledger_entry_type_old"
            RENAME TO "ledger_entry_type"
        `);
    await queryRunner.query(`
            ALTER TABLE "driver_ledger_entries"
            ALTER COLUMN "booking_id"
            SET NOT NULL
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_driver_ledger_booking_type" ON "driver_ledger_entries" USING btree ("booking_id", "type")
        `);
    await queryRunner.query(`
            ALTER TABLE "driver_ledger_entries"
            ADD CONSTRAINT "FK_450876f32fffcb5a1bea270a613" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "driver_ledger_entries" DROP COLUMN "reference"
        `);
    await queryRunner.query(`
            ALTER TABLE "bookings" DROP COLUMN "rated_at"
        `);
    await queryRunner.query(`
            ALTER TABLE "bookings" DROP COLUMN "customer_review"
        `);
    await queryRunner.query(`
            ALTER TABLE "bookings" DROP COLUMN "customer_rating"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_disputes_status_created"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."uq_disputes_open_booking"
        `);
    await queryRunner.query(`
            DROP TABLE "disputes"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."dispute_status"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_device_tokens_user"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."uq_device_tokens_token"
        `);
    await queryRunner.query(`
            DROP TABLE "device_tokens"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."device_platform"
        `);
  }
}
