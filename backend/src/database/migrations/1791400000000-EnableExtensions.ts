import { MigrationInterface, QueryRunner } from 'typeorm';

/** PostGIS powers all geography columns (driver positions, pickup points, service zones). */
export class EnableExtensions1791400000000 implements MigrationInterface {
  name = 'EnableExtensions1791400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS postgis');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP EXTENSION IF EXISTS postgis');
  }
}
