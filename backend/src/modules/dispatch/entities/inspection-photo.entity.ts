import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { PhotoSlot } from '../../../common/enums.js';
import { BookingInspection } from './booking-inspection.entity.js';

/** Metadata of one inspection photo. The file is in private object storage under storageKey. */
@Entity('inspection_photos')
@Index('ix_inspection_photos_inspection', ['inspectionId'])
// One photo per required angle; extras are limited in the service.
@Index('uq_inspection_photos_slot', ['inspectionId', 'slot'], {
  unique: true,
  where: '"slot" <> \'extra\'',
})
export class InspectionPhoto extends BaseEntity {
  @ManyToOne(() => BookingInspection, { onDelete: 'CASCADE' })
  @JoinColumn()
  inspection!: BookingInspection;

  @Column({ type: 'uuid' })
  inspectionId!: string;

  @Column({ type: 'enum', enum: PhotoSlot, enumName: 'photo_slot' })
  slot!: PhotoSlot;

  /** Server-generated key; never a client-supplied path or a public URL. */
  @Column({ type: 'varchar', length: 512 })
  storageKey!: string;

  /** Detected from the file bytes, not the client's claim. */
  @Column({ type: 'varchar', length: 40 })
  contentType!: string;

  @Column({ type: 'integer' })
  sizeBytes!: number;
}
