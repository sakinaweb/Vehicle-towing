import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '../config/app-config.service.js';
import { buildDataSourceOptions } from './typeorm.options.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        ...buildDataSourceOptions(config.database),
        // Each domain module registers its own entities via TypeOrmModule.forFeature().
        autoLoadEntities: true,
        // Fail fast on a wrong host instead of retrying for minutes.
        retryAttempts: config.isProduction ? 10 : 3,
        retryDelay: 2000,
      }),
    }),
  ],
})
export class DatabaseModule {}
