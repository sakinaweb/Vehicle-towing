import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuthSessionLastUsed1791500000000 implements MigrationInterface {
  name = 'AuthSessionLastUsed1791500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "auth_sessions"
            ADD "last_used_at" TIMESTAMP WITH TIME ZONE
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "auth_sessions" DROP COLUMN "last_used_at"
        `);
  }
}
