import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { validateEnv } from '../config/env.validation.js';
import { buildDataSourceOptions } from './typeorm.options.js';

// Used by the TypeORM CLI (migration:run / generate / revert), outside Nest.
loadEnv({ path: ['.env.local', '.env'], quiet: true });
const env = validateEnv(process.env);

const root = join(import.meta.dirname, '..');

// Run from the compiled build (dist/), so only .js files are loaded.
export default new DataSource({
  ...buildDataSourceOptions({
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    username: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    database: env.DATABASE_NAME,
    ssl: env.DATABASE_SSL,
    logging: env.DATABASE_LOGGING,
  }),
  entities: [join(root, '**', '*.entity.js')],
  migrations: [join(root, 'database', 'migrations', '*.js')],
});
