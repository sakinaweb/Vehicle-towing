import { MigrationInterface, QueryRunner } from 'typeorm';

/** Which check applies to a code: Twilio Verify's (true) or our own hash (false, e.g. backup SMS). */
export class OtpExternalCheck1792100000000 implements MigrationInterface {
  name = 'OtpExternalCheck1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "otp_challenges"
            ADD "external_check" boolean NOT NULL DEFAULT false
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "otp_challenges" DROP COLUMN "external_check"
        `);
  }
}
