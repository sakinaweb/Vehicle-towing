import { DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from './snake-naming.strategy.js';

export interface DatabaseSettings {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl: boolean;
  logging: boolean;
}

/**
 * Connection settings shared by the Nest app and the migration CLI.
 * Schema changes only ever happen through migrations (synchronize is always off).
 * Entities/migrations are added by each caller: Nest registers entities per module
 * (autoLoadEntities); the CLI loads compiled files from dist/.
 */
export function buildDataSourceOptions(db: DatabaseSettings): DataSourceOptions {
  return {
    type: 'postgres',
    host: db.host,
    port: db.port,
    username: db.username,
    password: db.password,
    database: db.database,
    ssl: db.ssl ? { rejectUnauthorized: true } : false,
    logging: db.logging,
    synchronize: false,
    migrationsRun: false,
    namingStrategy: new SnakeNamingStrategy(),
    migrationsTableName: 'schema_migrations',
  };
}
