import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { StorageProviderName } from '../../config/env.validation.js';
import { LocalStorageProvider } from './local-storage.provider.js';
import { S3StorageProvider } from './s3-storage.provider.js';
import { STORAGE_PROVIDER, StorageProvider } from './storage-provider.js';

/** Provides the StorageProvider selected by STORAGE_PROVIDER. */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): StorageProvider => {
        const { provider, localDir, s3 } = config.storage;
        switch (provider) {
          case StorageProviderName.S3:
            // Presence of these values is enforced by env validation.
            return new S3StorageProvider({
              bucket: s3.bucket!,
              region: s3.region!,
              endpoint: s3.endpoint,
              accessKeyId: s3.accessKeyId!,
              secretAccessKey: s3.secretAccessKey!,
              forcePathStyle: s3.forcePathStyle,
            });
          case StorageProviderName.Local:
            return new LocalStorageProvider(localDir);
        }
      },
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
