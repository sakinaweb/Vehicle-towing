import { MigrationInterface, QueryRunner } from 'typeorm';

export class Payments1791900000000 implements MigrationInterface {
  name = 'Payments1791900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Gap-free-in-practice, never reused invoice numbers (INV-000001, …).
    await queryRunner.query(`CREATE SEQUENCE "invoice_number_seq" START 1`);
    await queryRunner.query(
      `CREATE TYPE "public"."ledger_entry_type" AS ENUM('trip_earning', 'cash_collected')`,
    );
    await queryRunner.query(
      `CREATE TABLE "driver_ledger_entries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "driver_id" uuid NOT NULL, "booking_id" uuid NOT NULL, "type" "public"."ledger_entry_type" NOT NULL, "amount_fils" integer NOT NULL, "details" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_66d401d56f24b3a4138dfa454d4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_driver_ledger_driver_created" ON "driver_ledger_entries"  ("driver_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_driver_ledger_booking_type" ON "driver_ledger_entries"  ("booking_id", "type") `,
    );
    await queryRunner.query(
      `CREATE TABLE "invoices" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "booking_id" uuid NOT NULL, "invoice_number" character varying(20) NOT NULL, "issued_at" TIMESTAMP WITH TIME ZONE NOT NULL, "seller_name" character varying(120) NOT NULL, "seller_address" character varying(255), "seller_trn" character varying(15), "is_tax_invoice" boolean NOT NULL, "customer_name" character varying(255) NOT NULL, "subtotal_fils" integer NOT NULL, "vat_rate_bps" integer NOT NULL, "vat_fils" integer NOT NULL, "total_fils" integer NOT NULL, "currency" character(3) NOT NULL, "payment_method" "public"."payment_method" NOT NULL, CONSTRAINT "REL_ed9c7aa7846704bbcb648377e8" UNIQUE ("booking_id"), CONSTRAINT "PK_668cef7c22a427fd822cc1be3ce" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_invoices_booking" ON "invoices"  ("booking_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_invoices_number" ON "invoices"  ("invoice_number") `,
    );
    await queryRunner.query(
      `CREATE TABLE "payment_webhook_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "provider" character varying(40) NOT NULL, "event_id" character varying(255) NOT NULL, "type" character varying(100) NOT NULL, "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_750875e71d97974be92cee813ba" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_payment_webhook_events_event" ON "payment_webhook_events"  ("provider", "event_id") `,
    );
    await queryRunner.query(`ALTER TABLE "payments" ADD "authorized_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "payments" ADD "collected_by_id" uuid`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_payments_booking" ON "payments"  ("booking_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "driver_ledger_entries" ADD CONSTRAINT "FK_0aa068df42a7294b00cb4eb90a3" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "driver_ledger_entries" ADD CONSTRAINT "FK_450876f32fffcb5a1bea270a613" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "FK_ed9c7aa7846704bbcb648377e8f" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_f01c6758242865c661883a44d55" FOREIGN KEY ("collected_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_f01c6758242865c661883a44d55"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "FK_ed9c7aa7846704bbcb648377e8f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "driver_ledger_entries" DROP CONSTRAINT "FK_450876f32fffcb5a1bea270a613"`,
    );
    await queryRunner.query(
      `ALTER TABLE "driver_ledger_entries" DROP CONSTRAINT "FK_0aa068df42a7294b00cb4eb90a3"`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_payments_booking"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "collected_by_id"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "authorized_at"`);
    await queryRunner.query(`DROP INDEX "public"."uq_payment_webhook_events_event"`);
    await queryRunner.query(`DROP TABLE "payment_webhook_events"`);
    await queryRunner.query(`DROP INDEX "public"."uq_invoices_number"`);
    await queryRunner.query(`DROP INDEX "public"."uq_invoices_booking"`);
    await queryRunner.query(`DROP TABLE "invoices"`);
    await queryRunner.query(`DROP INDEX "public"."uq_driver_ledger_booking_type"`);
    await queryRunner.query(`DROP INDEX "public"."ix_driver_ledger_driver_created"`);
    await queryRunner.query(`DROP TABLE "driver_ledger_entries"`);
    await queryRunner.query(`DROP TYPE "public"."ledger_entry_type"`);
    await queryRunner.query(`DROP SEQUENCE "invoice_number_seq"`);
  }
}
