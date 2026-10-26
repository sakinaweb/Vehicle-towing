import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { IsDateString, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { DocumentStatus, DriverDocumentType, KycStatus } from '../../common/enums.js';
import {
  DOCUMENT_TYPES,
  detectFileType,
  EXTENSION,
} from '../../infrastructure/storage/file-type.js';
import { STORAGE_PROVIDER } from '../../infrastructure/storage/storage-provider.js';
import type { StorageProvider } from '../../infrastructure/storage/storage-provider.js';
import { AuditService } from '../audit/audit.service.js';
import { DriverDocument } from './entities/driver-document.entity.js';
import { Driver } from './entities/driver.entity.js';

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const REQUIRED_DOCUMENTS = Object.values(DriverDocumentType);

export class UploadDocumentDto {
  @ApiPropertyOptional({ example: '784-1990-1234567-1' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9\- /]+$/, {
    message: 'documentNumber may only contain letters, digits, spaces, - and /',
  })
  documentNumber?: string;

  @ApiPropertyOptional({ example: '2028-05-31', description: 'Expiry date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString({ strict: true })
  expiresOn?: string;
}

/** OpenAPI body of the multipart document upload. */
export const DOCUMENT_UPLOAD_SCHEMA = {
  type: 'object',
  required: ['file'],
  properties: {
    file: {
      type: 'string',
      format: 'binary',
      description: 'PDF, JPEG, PNG, WebP or HEIC, up to 10 MB',
    },
    documentNumber: { type: 'string', example: '784-1990-1234567-1' },
    expiresOn: { type: 'string', format: 'date', example: '2028-05-31' },
  },
};

export class DriverDocumentView {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: DriverDocumentType }) type!: DriverDocumentType;
  @ApiProperty({ enum: DocumentStatus }) status!: DocumentStatus;
  @ApiPropertyOptional({ nullable: true, type: String }) documentNumber!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) expiresOn!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) rejectionReason!: string | null;
  @ApiProperty() uploadedAt!: Date;

  static from(d: DriverDocument): DriverDocumentView {
    return {
      id: d.id,
      type: d.type,
      status: d.status,
      documentNumber: d.documentNumber,
      expiresOn: d.expiresOn,
      rejectionReason: d.rejectionReason,
      uploadedAt: d.updatedAt,
    };
  }
}

export class DriverDocumentListView {
  @ApiProperty({ type: [DriverDocumentView] }) documents!: DriverDocumentView[];
}

/** A driver's own KYC documents. Files go to private storage under server-generated keys. */
@Injectable()
export class DriverDocumentsService {
  private readonly logger = new Logger(DriverDocumentsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string): Promise<DriverDocumentView[]> {
    const driver = await this.dataSource.manager.findOneBy(Driver, { userId });
    if (!driver) throw new NotFoundException('Driver profile not found.');
    const docs = await this.dataSource.manager.find(DriverDocument, {
      where: { driverId: driver.id },
      order: { type: 'ASC' },
    });
    return docs.map((d) => DriverDocumentView.from(d));
  }

  /** Uploads or replaces one document. Resubmitting after a rejection puts KYC back in review. */
  async upload(
    userId: string,
    type: DriverDocumentType,
    dto: UploadDocumentDto,
    file: { buffer: Buffer; size: number } | undefined,
  ): Promise<DriverDocumentView> {
    if (!file?.buffer?.length)
      throw new BadRequestException('Attach the document in the "file" field.');
    if (file.size > MAX_DOCUMENT_BYTES)
      throw new BadRequestException('Documents can be at most 10 MB.');
    const detected = detectFileType(file.buffer);
    if (!detected || !DOCUMENT_TYPES.includes(detected)) {
      throw new BadRequestException('Documents must be PDF, JPEG, PNG, WebP or HEIC files.');
    }
    if (dto.expiresOn && dto.expiresOn <= new Date().toISOString().slice(0, 10)) {
      throw new BadRequestException('This document has expired. Upload a valid one.');
    }
    const driver = await this.dataSource.manager.findOneBy(Driver, { userId });
    if (!driver) throw new NotFoundException('Driver profile not found.');
    this.assertCanChange(driver.kycStatus);

    const key = `drivers/${driver.id}/documents/${type}-${randomUUID()}.${EXTENSION[detected]}`;
    await this.storage.put(key, file.buffer, detected);
    let previousKey: string | null = null;
    let reopened = false;
    try {
      await this.dataSource.transaction(async (em) => {
        const locked = await em.findOneOrFail(Driver, {
          where: { id: driver.id },
          lock: { mode: 'pessimistic_write' },
        });
        this.assertCanChange(locked.kycStatus);
        const existing = await em.findOneBy(DriverDocument, { driverId: driver.id, type });
        const values = {
          fileKey: key,
          status: DocumentStatus.Pending,
          documentNumber: dto.documentNumber?.trim() || null,
          expiresOn: dto.expiresOn ?? null,
          reviewedById: null,
          reviewedAt: null,
          rejectionReason: null,
        };
        if (existing) {
          previousKey = existing.fileKey;
          await em.update(DriverDocument, existing.id, values);
        } else {
          await em.insert(DriverDocument, { driverId: driver.id, type, ...values });
        }
        if (locked.kycStatus === KycStatus.Rejected) {
          await em.update(Driver, driver.id, { kycStatus: KycStatus.Pending });
          reopened = true;
        }
      });
    } catch (err) {
      await this.deleteObject(key);
      throw err;
    }
    if (previousKey) await this.deleteObject(previousKey);
    await this.audit.record({
      action: 'kyc.document_uploaded',
      entityType: 'driver',
      entityId: driver.id,
      actorUserId: userId,
      metadata: { type, resubmitted: reopened },
    });
    const doc = await this.dataSource.manager.findOneByOrFail(DriverDocument, {
      driverId: driver.id,
      type,
    });
    return DriverDocumentView.from(doc);
  }

  private assertCanChange(status: KycStatus) {
    if (status === KycStatus.Approved || status === KycStatus.Suspended) {
      throw new ConflictException(
        'Your documents are locked after review. Contact TowNow support to update them.',
      );
    }
  }

  private async deleteObject(key: string) {
    try {
      await this.storage.delete(key);
    } catch (err) {
      this.logger.warn(`Could not delete stored object ${key}: ${String(err)}`);
    }
  }
}
