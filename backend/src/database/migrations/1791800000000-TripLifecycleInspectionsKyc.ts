import { MigrationInterface, QueryRunner } from 'typeorm';

export class TripLifecycleInspectionsKyc1791800000000 implements MigrationInterface {
  name = 'TripLifecycleInspectionsKyc1791800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."inspection_stage" AS ENUM('pickup', 'return')`);
    await queryRunner.query(
      `CREATE TYPE "public"."fuel_level" AS ENUM('empty', 'quarter', 'half', 'three_quarters', 'full')`,
    );
    await queryRunner.query(
      `CREATE TABLE "booking_inspections" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "booking_id" uuid NOT NULL, "stage" "public"."inspection_stage" NOT NULL, "odometer_km" integer NOT NULL, "fuel_level" "public"."fuel_level" NOT NULL, "checklist" jsonb NOT NULL, "notes" text, "submitted_at" TIMESTAMP WITH TIME ZONE, "submitted_by_id" uuid, CONSTRAINT "PK_9e3d9d4d5e28baebe93365ad6f3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_booking_inspections_booking_stage" ON "booking_inspections"  ("booking_id", "stage") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."photo_slot" AS ENUM('front', 'back', 'left', 'right', 'extra')`,
    );
    await queryRunner.query(
      `CREATE TABLE "inspection_photos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "inspection_id" uuid NOT NULL, "slot" "public"."photo_slot" NOT NULL, "storage_key" character varying(512) NOT NULL, "content_type" character varying(40) NOT NULL, "size_bytes" integer NOT NULL, CONSTRAINT "PK_44faef4ea0904da59d462a5ef0e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_inspection_photos_slot" ON "inspection_photos"  ("inspection_id", "slot") WHERE "slot" <> 'extra'`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_inspection_photos_inspection" ON "inspection_photos"  ("inspection_id") `,
    );
    await queryRunner.query(`ALTER TABLE "drivers" ADD "kyc_reviewed_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "drivers" ADD "kyc_reviewed_by_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "kyc_rejection_reason" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD CONSTRAINT "FK_0d82d489e29176574bedb6d813e" FOREIGN KEY ("kyc_reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "booking_inspections" ADD CONSTRAINT "FK_ccc4d250317d84c841ca419a382" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "booking_inspections" ADD CONSTRAINT "FK_d5a4e71d6932b1056e1fe8113c5" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "inspection_photos" ADD CONSTRAINT "FK_f454cf99002f064451c3cf8da53" FOREIGN KEY ("inspection_id") REFERENCES "booking_inspections"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "inspection_photos" DROP CONSTRAINT "FK_f454cf99002f064451c3cf8da53"`,
    );
    await queryRunner.query(
      `ALTER TABLE "booking_inspections" DROP CONSTRAINT "FK_d5a4e71d6932b1056e1fe8113c5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "booking_inspections" DROP CONSTRAINT "FK_ccc4d250317d84c841ca419a382"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP CONSTRAINT "FK_0d82d489e29176574bedb6d813e"`,
    );
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "kyc_rejection_reason"`);
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "kyc_reviewed_by_id"`);
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "kyc_reviewed_at"`);
    await queryRunner.query(`DROP INDEX "public"."ix_inspection_photos_inspection"`);
    await queryRunner.query(`DROP INDEX "public"."uq_inspection_photos_slot"`);
    await queryRunner.query(`DROP TABLE "inspection_photos"`);
    await queryRunner.query(`DROP TYPE "public"."photo_slot"`);
    await queryRunner.query(`DROP INDEX "public"."uq_booking_inspections_booking_stage"`);
    await queryRunner.query(`DROP TABLE "booking_inspections"`);
    await queryRunner.query(`DROP TYPE "public"."fuel_level"`);
    await queryRunner.query(`DROP TYPE "public"."inspection_stage"`);
  }
}
