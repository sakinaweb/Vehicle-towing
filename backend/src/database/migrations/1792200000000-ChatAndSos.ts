import { MigrationInterface, QueryRunner } from 'typeorm';

/** SOS alerts, and an app-generated client id on chat messages (idempotent retries). */

export class ChatAndSos1792200000000 implements MigrationInterface {
  name = 'ChatAndSos1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TYPE "public"."sos_status" AS ENUM('open', 'acknowledged', 'resolved')
        `);
    await queryRunner.query(`
            CREATE TABLE "sos_alerts" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "raised_by_id" uuid NOT NULL,
                "raised_by_role" "public"."user_role" NOT NULL,
                "booking_id" uuid,
                "lat" double precision,
                "lng" double precision,
                "accuracy_meters" real,
                "note" character varying(500),
                "status" "public"."sos_status" NOT NULL DEFAULT 'open',
                "handled_by_id" uuid,
                "acknowledged_at" TIMESTAMP WITH TIME ZONE,
                "resolved_at" TIMESTAMP WITH TIME ZONE,
                "resolution" character varying(500),
                CONSTRAINT "PK_5c6f2f5f40ab2224315e007b9c4" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "ix_sos_alerts_status_created" ON "sos_alerts" ("status", "created_at")
        `);
    await queryRunner.query(`
            ALTER TABLE "chat_messages"
            ADD "client_id" uuid
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_chat_messages_sender_client" ON "chat_messages" ("sender_id", "client_id")
            WHERE "client_id" IS NOT NULL
        `);
    await queryRunner.query(`
            ALTER TABLE "sos_alerts"
            ADD CONSTRAINT "FK_dcf1e743fc7991d0be3b4efba25" FOREIGN KEY ("raised_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "sos_alerts"
            ADD CONSTRAINT "FK_9f8eddcf1c41bb13d9e9de34437" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "sos_alerts"
            ADD CONSTRAINT "FK_1a6017b6003e61043abb0b94165" FOREIGN KEY ("handled_by_id") REFERENCES "users"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "sos_alerts" DROP CONSTRAINT "FK_1a6017b6003e61043abb0b94165"
        `);
    await queryRunner.query(`
            ALTER TABLE "sos_alerts" DROP CONSTRAINT "FK_9f8eddcf1c41bb13d9e9de34437"
        `);
    await queryRunner.query(`
            ALTER TABLE "sos_alerts" DROP CONSTRAINT "FK_dcf1e743fc7991d0be3b4efba25"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."uq_chat_messages_sender_client"
        `);
    await queryRunner.query(`
            ALTER TABLE "chat_messages" DROP COLUMN "client_id"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."ix_sos_alerts_status_created"
        `);
    await queryRunner.query(`
            DROP TABLE "sos_alerts"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."sos_status"
        `);
  }
}
