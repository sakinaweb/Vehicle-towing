import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { InspectionStage, PhotoSlot, UserRole } from '../../common/enums.js';
import { detectFileType, EXTENSION, IMAGE_TYPES } from '../../infrastructure/storage/file-type.js';
import { STORAGE_PROVIDER } from '../../infrastructure/storage/storage-provider.js';
import type {
  StorageProvider,
  StoredObject,
} from '../../infrastructure/storage/storage-provider.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { Booking } from '../bookings/entities/booking.entity.js';
import { Customer } from '../customers/entities/customer.entity.js';
import { Driver } from '../drivers/entities/driver.entity.js';
import { BookingInspection } from './entities/booking-inspection.entity.js';
import { InspectionPhoto } from './entities/inspection-photo.entity.js';
import { InspectionDetailsDto, InspectionView } from './inspection.dto.js';
import {
  inspectionEditError,
  MAX_EXTRA_PHOTOS,
  MAX_PHOTO_BYTES,
  missingPhotoSlots,
  odometerError,
} from './trip.rules.js';

export interface UploadedPhoto {
  buffer: Buffer;
  size: number;
}

/**
 * Pickup / return inspections, written only by the booking's assigned driver while
 * the trip is in the matching stage. Submitting locks the inspection for good.
 * Lock order matches matching: booking → inspection.
 */
@Injectable()
export class InspectionsService {
  private readonly logger = new Logger(InspectionsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- driver writes

  async saveDetails(
    userId: string,
    bookingId: string,
    stage: InspectionStage,
    dto: InspectionDetailsDto,
  ): Promise<InspectionView> {
    const id = await this.dataSource.transaction(async (em) => {
      const booking = await this.lockOwnJob(em, userId, bookingId);
      const existing = await this.lockInspection(em, bookingId, stage);
      this.assertEditable(stage, booking, existing);

      const pickup =
        stage === InspectionStage.Return
          ? await em.findOneBy(BookingInspection, { bookingId, stage: InspectionStage.Pickup })
          : null;
      const odoError = odometerError(stage, dto.odometerKm, pickup?.odometerKm ?? null);
      if (odoError) throw new BadRequestException(odoError);

      const values = {
        odometerKm: dto.odometerKm,
        fuelLevel: dto.fuelLevel,
        checklist: { ...dto.checklist },
        notes: dto.notes?.trim() || null,
      };
      if (existing) {
        await em.update(BookingInspection, existing.id, values);
        return existing.id;
      }
      const created = await em.save(em.create(BookingInspection, { bookingId, stage, ...values }));
      return created.id;
    });
    return this.view(this.dataSource.manager, id);
  }

  async addPhoto(
    userId: string,
    bookingId: string,
    stage: InspectionStage,
    slot: PhotoSlot,
    file: UploadedPhoto | undefined,
  ): Promise<InspectionView> {
    if (!file?.buffer?.length) throw new BadRequestException('Attach a photo in the "file" field.');
    if (file.size > MAX_PHOTO_BYTES) throw new BadRequestException('Photos can be at most 8 MB.');
    const type = detectFileType(file.buffer);
    if (!type || !IMAGE_TYPES.includes(type)) {
      throw new BadRequestException('Photos must be JPEG, PNG, WebP or HEIC images.');
    }

    // Cheap checks before uploading, so rejected requests never reach storage.
    await this.dataSource.transaction(async (em) => {
      const booking = await this.lockOwnJob(em, userId, bookingId);
      this.assertEditable(stage, booking, await this.requireInspection(em, bookingId, stage));
    });

    const key = `bookings/${bookingId}/inspections/${stage}/${randomUUID()}.${EXTENSION[type]}`;
    await this.storage.put(key, file.buffer, type);

    let replacedKey: string | null = null;
    let inspectionId: string;
    try {
      inspectionId = await this.dataSource.transaction(async (em) => {
        const booking = await this.lockOwnJob(em, userId, bookingId);
        const inspection = await this.requireInspection(em, bookingId, stage);
        this.assertEditable(stage, booking, inspection);
        if (slot === PhotoSlot.Extra) {
          const extras = await em.countBy(InspectionPhoto, { inspectionId: inspection.id, slot });
          if (extras >= MAX_EXTRA_PHOTOS) {
            throw new ConflictException(`At most ${MAX_EXTRA_PHOTOS} extra photos per inspection.`);
          }
        } else {
          // Retaking a required angle replaces the previous photo.
          const previous = await em.findOneBy(InspectionPhoto, {
            inspectionId: inspection.id,
            slot,
          });
          if (previous) {
            await em.delete(InspectionPhoto, previous.id);
            replacedKey = previous.storageKey;
          }
        }
        await em.insert(InspectionPhoto, {
          inspectionId: inspection.id,
          slot,
          storageKey: key,
          contentType: type,
          sizeBytes: file.size,
        });
        return inspection.id;
      });
    } catch (err) {
      await this.deleteObject(key); // nothing references it
      throw err;
    }
    if (replacedKey) await this.deleteObject(replacedKey);
    return this.view(this.dataSource.manager, inspectionId);
  }

  async deletePhoto(
    userId: string,
    bookingId: string,
    stage: InspectionStage,
    photoId: string,
  ): Promise<InspectionView> {
    const { inspectionId, key } = await this.dataSource.transaction(async (em) => {
      const booking = await this.lockOwnJob(em, userId, bookingId);
      const inspection = await this.requireInspection(em, bookingId, stage);
      this.assertEditable(stage, booking, inspection);
      const photo = await em.findOneBy(InspectionPhoto, {
        id: photoId,
        inspectionId: inspection.id,
      });
      if (!photo) throw new NotFoundException('Photo not found.');
      await em.delete(InspectionPhoto, photo.id);
      return { inspectionId: inspection.id, key: photo.storageKey };
    });
    await this.deleteObject(key);
    return this.view(this.dataSource.manager, inspectionId);
  }

  /** Locks the inspection. Needs the four required angles. Repeating it returns the inspection. */
  async submit(userId: string, bookingId: string, stage: InspectionStage): Promise<InspectionView> {
    let newlySubmitted = false;
    const id = await this.dataSource.transaction(async (em) => {
      const booking = await this.lockOwnJob(em, userId, bookingId);
      const inspection = await this.requireInspection(em, bookingId, stage);
      if (inspection.submittedAt) return inspection.id; // idempotent
      this.assertEditable(stage, booking, inspection);
      const photos = await em.findBy(InspectionPhoto, { inspectionId: inspection.id });
      const missing = missingPhotoSlots(photos.map((p) => p.slot));
      if (missing.length) {
        throw new ConflictException(
          `Add the ${missing.join(', ')} photo${missing.length > 1 ? 's' : ''} first.`,
        );
      }
      await em.update(BookingInspection, inspection.id, {
        submittedAt: new Date(),
        submittedById: userId,
      });
      newlySubmitted = true;
      return inspection.id;
    });
    const view = await this.view(this.dataSource.manager, id);
    if (newlySubmitted) {
      await this.audit.record({
        action: 'inspection.submitted',
        entityType: 'booking',
        entityId: bookingId,
        actorUserId: userId,
        metadata: { stage, odometerKm: view.odometerKm, photos: view.photos.length },
      });
    }
    return view;
  }

  // ---------------------------------------------------------------- reads (customer, driver, admin)

  async list(viewer: AuthContext, bookingId: string): Promise<InspectionView[]> {
    const em = this.dataSource.manager;
    await this.assertCanView(em, viewer, bookingId);
    const rows = await em.find(BookingInspection, {
      where: { bookingId },
      order: { createdAt: 'ASC' },
    });
    return Promise.all(rows.map((r) => this.view(em, r.id)));
  }

  async photo(viewer: AuthContext, bookingId: string, photoId: string): Promise<StoredObject> {
    const em = this.dataSource.manager;
    await this.assertCanView(em, viewer, bookingId);
    const photo = await em
      .createQueryBuilder(InspectionPhoto, 'p')
      .innerJoin(BookingInspection, 'i', 'i.id = p.inspection_id')
      .where('p.id = :photoId AND i.booking_id = :bookingId', { photoId, bookingId })
      .getOne();
    if (!photo) throw new NotFoundException('Photo not found.');
    return this.storage.get(photo.storageKey);
  }

  // ---------------------------------------------------------------- helpers

  private async lockOwnJob(em: EntityManager, userId: string, bookingId: string): Promise<Booking> {
    const booking = await em.findOne(Booking, {
      where: { id: bookingId },
      lock: { mode: 'pessimistic_write' },
    });
    const driver = await em.findOneBy(Driver, { userId });
    if (!booking || !driver || booking.driverId !== driver.id)
      throw new NotFoundException('Job not found.');
    return booking;
  }

  private lockInspection(em: EntityManager, bookingId: string, stage: InspectionStage) {
    return em.findOne(BookingInspection, {
      where: { bookingId, stage },
      lock: { mode: 'pessimistic_write' },
    });
  }

  private async requireInspection(em: EntityManager, bookingId: string, stage: InspectionStage) {
    const inspection = await this.lockInspection(em, bookingId, stage);
    if (!inspection) {
      throw new ConflictException(
        'Save the odometer, fuel level and checklist before adding photos.',
      );
    }
    return inspection;
  }

  private assertEditable(
    stage: InspectionStage,
    booking: Booking,
    inspection: BookingInspection | null,
  ) {
    const error = inspectionEditError(stage, booking.status, inspection?.submittedAt ?? null);
    if (error) throw new ConflictException(error);
  }

  /** The booking's customer, its assigned driver, or an admin. Anyone else gets a 404. */
  private async assertCanView(
    em: EntityManager,
    viewer: AuthContext,
    bookingId: string,
  ): Promise<void> {
    const booking = await em.findOneBy(Booking, { id: bookingId });
    if (booking) {
      if (viewer.role === UserRole.Admin) return;
      if (viewer.role === UserRole.Customer) {
        const customer = await em.findOneBy(Customer, { userId: viewer.userId });
        if (customer && booking.customerId === customer.id) return;
      }
      if (viewer.role === UserRole.Driver) {
        const driver = await em.findOneBy(Driver, { userId: viewer.userId });
        if (driver && booking.driverId === driver.id) return;
      }
    }
    throw new NotFoundException('Booking not found.');
  }

  private async view(em: EntityManager, inspectionId: string): Promise<InspectionView> {
    const i = await em.findOneByOrFail(BookingInspection, { id: inspectionId });
    const photos = await em.find(InspectionPhoto, {
      where: { inspectionId },
      order: { createdAt: 'ASC' },
    });
    return {
      id: i.id,
      stage: i.stage,
      odometerKm: i.odometerKm,
      fuelLevel: i.fuelLevel,
      checklist: i.checklist,
      notes: i.notes,
      submittedAt: i.submittedAt,
      photos: photos.map((p) => ({
        id: p.id,
        slot: p.slot,
        contentType: p.contentType,
        sizeBytes: p.sizeBytes,
        uploadedAt: p.createdAt,
      })),
    };
  }

  private async deleteObject(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (err) {
      this.logger.warn(`Could not delete stored object ${key}: ${String(err)}`);
    }
  }
}
