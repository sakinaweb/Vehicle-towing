import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { DataSource, In } from 'typeorm';
import {
  DocumentStatus,
  DriverAvailability,
  DriverDocumentType,
  KycStatus,
  UserStatus,
} from '../../common/enums.js';
import { RealtimeEmitter, RealtimeEvent } from '../../infrastructure/realtime/realtime.emitter.js';
import { STORAGE_PROVIDER } from '../../infrastructure/storage/storage-provider.js';
import type {
  StorageProvider,
  StoredObject,
} from '../../infrastructure/storage/storage-provider.js';
import { AuditService } from '../audit/audit.service.js';
import { Booking } from '../bookings/entities/booking.entity.js';
import { DriverLocationService } from '../dispatch/driver-location.service.js';
import type { AfterCommit } from '../dispatch/matching.service.js';
import { MatchingService } from '../dispatch/matching.service.js';
import { ACTIVE_TRIP_STATUSES } from '../dispatch/trip.rules.js';
import { DriverDocumentView, REQUIRED_DOCUMENTS } from '../drivers/driver-documents.service.js';
import { TowTruckView } from '../drivers/driver.dto.js';
import { DriverDocument } from '../drivers/entities/driver-document.entity.js';
import { Driver } from '../drivers/entities/driver.entity.js';
import { TowTruck } from '../drivers/entities/tow-truck.entity.js';

export class KycQueueQuery {
  @ApiPropertyOptional({ enum: KycStatus, default: KycStatus.Pending })
  @IsOptional()
  @IsEnum(KycStatus)
  kycStatus: KycStatus = KycStatus.Pending;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}

export class RejectKycDto {
  @ApiProperty({ example: 'Emirates ID photo is blurry; please upload a clear scan.' })
  @IsString()
  @MinLength(5)
  @MaxLength(255)
  reason!: string;
}

export class KycQueueItemView {
  @ApiProperty() driverId!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) fullName!: string | null;
  @ApiProperty() phone!: string;
  @ApiProperty({ enum: KycStatus }) kycStatus!: KycStatus;
  @ApiProperty() documentsUploaded!: number;
  @ApiProperty() documentsRequired!: number;
  @ApiProperty() towTrucks!: number;
  @ApiProperty({ enum: DriverAvailability }) availability!: DriverAvailability;
  @ApiProperty() registeredAt!: Date;
}

export class KycQueueView {
  @ApiProperty({ type: [KycQueueItemView] }) items!: KycQueueItemView[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}

export class KycDriverView {
  @ApiProperty() driverId!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) fullName!: string | null;
  @ApiProperty() phone!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) email!: string | null;
  @ApiProperty({ enum: UserStatus }) accountStatus!: UserStatus;
  @ApiProperty({ enum: KycStatus }) kycStatus!: KycStatus;
  @ApiPropertyOptional({ nullable: true, type: Date }) kycReviewedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true, type: String }) kycRejectionReason!: string | null;
  @ApiProperty({ enum: DriverAvailability }) availability!: DriverAvailability;
  @ApiProperty() experienceYears!: number;
  @ApiProperty() totalTrips!: number;
  @ApiProperty() registeredAt!: Date;
  @ApiProperty({ type: [TowTruckView] }) towTrucks!: TowTruckView[];
  @ApiProperty({ type: [DriverDocumentView] }) documents!: DriverDocumentView[];
  @ApiProperty({
    enum: DriverDocumentType,
    isArray: true,
    description: 'Must be uploaded before approval',
  })
  missingDocuments!: DriverDocumentType[];
}

/**
 * Admin KYC review. Only approved drivers can go online and be matched (Phase 4
 * rule, unchanged). Rejecting takes the driver off dispatch. Every decision is audited.
 */
@Injectable()
export class AdminKycService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly matching: MatchingService,
    private readonly locations: DriverLocationService,
    private readonly emitter: RealtimeEmitter,
    private readonly audit: AuditService,
  ) {}

  async queue(q: KycQueueQuery): Promise<KycQueueView> {
    const em = this.dataSource.manager;
    const [drivers, total] = await em.findAndCount(Driver, {
      where: { kycStatus: q.kycStatus },
      relations: { user: true },
      order: { createdAt: 'ASC' }, // oldest application first
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    });
    const ids = drivers.map((d) => d.id);
    const docCounts = await this.countBy(DriverDocument, ids);
    const truckCounts = await this.countBy(TowTruck, ids);
    return {
      items: drivers.map((d) => ({
        driverId: d.id,
        fullName: d.user.fullName,
        phone: d.user.phone,
        kycStatus: d.kycStatus,
        documentsUploaded: docCounts.get(d.id) ?? 0,
        documentsRequired: REQUIRED_DOCUMENTS.length,
        towTrucks: truckCounts.get(d.id) ?? 0,
        availability: d.availability,
        registeredAt: d.createdAt,
      })),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  async detail(driverId: string): Promise<KycDriverView> {
    const em = this.dataSource.manager;
    const driver = await em.findOne(Driver, { where: { id: driverId }, relations: { user: true } });
    if (!driver) throw new NotFoundException('Driver not found.');
    const [trucks, docs] = await Promise.all([
      em.find(TowTruck, { where: { driverId }, order: { createdAt: 'ASC' } }),
      em.find(DriverDocument, { where: { driverId }, order: { type: 'ASC' } }),
    ]);
    return {
      driverId: driver.id,
      fullName: driver.user.fullName,
      phone: driver.user.phone,
      email: driver.user.email,
      accountStatus: driver.user.status,
      kycStatus: driver.kycStatus,
      kycReviewedAt: driver.kycReviewedAt,
      kycRejectionReason: driver.kycRejectionReason,
      availability: driver.availability,
      experienceYears: driver.experienceYears,
      totalTrips: driver.totalTrips,
      registeredAt: driver.createdAt,
      towTrucks: trucks.map((t) => TowTruckView.from(t)),
      documents: docs.map((d) => DriverDocumentView.from(d)),
      missingDocuments: REQUIRED_DOCUMENTS.filter((t) => !docs.some((d) => d.type === t)),
    };
  }

  async documentFile(driverId: string, documentId: string): Promise<StoredObject> {
    const doc = await this.dataSource.manager.findOneBy(DriverDocument, {
      id: documentId,
      driverId,
    });
    if (!doc) throw new NotFoundException('Document not found.');
    return this.storage.get(doc.fileKey);
  }

  /** Approves a pending (or previously rejected) driver. Needs every required document. Idempotent. */
  async approve(adminUserId: string, driverId: string): Promise<KycDriverView> {
    let previous: KycStatus | null = null;
    let driverUserId = '';
    await this.dataSource.transaction(async (em) => {
      const driver = await em.findOne(Driver, {
        where: { id: driverId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!driver) throw new NotFoundException('Driver not found.');
      if (driver.kycStatus === KycStatus.Approved) return;
      if (driver.kycStatus === KycStatus.Suspended) {
        throw new ConflictException('This driver is suspended; lift the suspension first.');
      }
      const docs = await em.findBy(DriverDocument, { driverId });
      const missing = REQUIRED_DOCUMENTS.filter((t) => !docs.some((d) => d.type === t));
      if (missing.length) {
        throw new ConflictException(`Missing documents: ${missing.join(', ')}.`);
      }
      const now = new Date();
      await em.update(Driver, driverId, {
        kycStatus: KycStatus.Approved,
        kycReviewedAt: now,
        kycReviewedById: adminUserId,
        kycRejectionReason: null,
      });
      await em.update(
        DriverDocument,
        { driverId, status: In([DocumentStatus.Pending, DocumentStatus.Rejected]) },
        {
          status: DocumentStatus.Approved,
          reviewedById: adminUserId,
          reviewedAt: now,
          rejectionReason: null,
        },
      );
      previous = driver.kycStatus;
      driverUserId = driver.userId;
    });
    if (previous) {
      await this.audit.record({
        action: 'kyc.approved',
        entityType: 'driver',
        entityId: driverId,
        actorUserId: adminUserId,
        metadata: { previousStatus: previous },
      });
      this.emitter.toUser(driverUserId, RealtimeEvent.KycUpdated, {
        kycStatus: KycStatus.Approved,
      });
    }
    return this.detail(driverId);
  }

  /**
   * Rejects a pending application, or revokes an approval. A driver on a trip cannot be
   * rejected mid-job; an online driver is taken offline and loses any ringing offer.
   */
  async reject(adminUserId: string, driverId: string, reason: string): Promise<KycDriverView> {
    const after: AfterCommit = [];
    let previous: KycStatus | null = null;
    let driverUserId = '';
    await this.dataSource.transaction(async (em) => {
      // Lock order booking → offer → driver, as in matching.
      await this.matching.withdrawPendingOfferForDriver(em, driverId, after);
      const driver = await em.findOne(Driver, {
        where: { id: driverId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!driver) throw new NotFoundException('Driver not found.');
      if (driver.kycStatus === KycStatus.Rejected) return; // idempotent
      if (driver.kycStatus === KycStatus.Suspended) {
        throw new ConflictException('This driver is suspended.');
      }
      const onTrip = await em.existsBy(Booking, { driverId, status: In(ACTIVE_TRIP_STATUSES) });
      if (onTrip) {
        throw new ConflictException('This driver is on a job. Reject after the job is finished.');
      }
      const now = new Date();
      await em.update(Driver, driverId, {
        kycStatus: KycStatus.Rejected,
        kycReviewedAt: now,
        kycReviewedById: adminUserId,
        kycRejectionReason: reason.trim(),
        availability: DriverAvailability.Offline,
      });
      await em.update(
        DriverDocument,
        { driverId, status: DocumentStatus.Pending },
        {
          status: DocumentStatus.Rejected,
          reviewedById: adminUserId,
          reviewedAt: now,
          rejectionReason: reason.trim(),
        },
      );
      previous = driver.kycStatus;
      driverUserId = driver.userId;
      after.push(() => this.locations.forget(driverId));
    });
    if (previous) {
      for (const fn of after) await fn();
      await this.audit.record({
        action: 'kyc.rejected',
        entityType: 'driver',
        entityId: driverId,
        actorUserId: adminUserId,
        metadata: { previousStatus: previous, reason: reason.trim() },
      });
      this.emitter.toUser(driverUserId, RealtimeEvent.KycUpdated, {
        kycStatus: KycStatus.Rejected,
      });
    }
    return this.detail(driverId);
  }

  private async countBy(entity: typeof DriverDocument | typeof TowTruck, driverIds: string[]) {
    if (!driverIds.length) return new Map<string, number>();
    const rows: { driverId: string; n: string }[] = await this.dataSource
      .createQueryBuilder(entity, 'x')
      .select('x.driver_id', 'driverId')
      .addSelect('COUNT(*)', 'n')
      .where('x.driver_id IN (:...ids)', { ids: driverIds })
      .groupBy('x.driver_id')
      .getRawMany();
    return new Map(rows.map((r) => [r.driverId, Number(r.n)]));
  }
}
