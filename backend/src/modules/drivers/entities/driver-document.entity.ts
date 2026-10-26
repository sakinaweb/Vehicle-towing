import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { DocumentStatus, DriverDocumentType } from '../../../common/enums.js';
import { User } from '../../users/entities/user.entity.js';
import { Driver } from './driver.entity.js';

/** KYC document (Emirates ID, licence, Mulkiya, insurance). The file itself lives in object storage. */
@Entity('driver_documents')
@Index('uq_driver_documents_driver_type', ['driverId', 'type'], { unique: true })
export class DriverDocument extends BaseEntity {
  @ManyToOne(() => Driver, { onDelete: 'CASCADE' })
  @JoinColumn()
  driver!: Driver;

  @Column({ type: 'uuid' })
  driverId!: string;

  @Column({ type: 'enum', enum: DriverDocumentType, enumName: 'driver_document_type' })
  type!: DriverDocumentType;

  @Column({
    type: 'enum',
    enum: DocumentStatus,
    enumName: 'document_status',
    default: DocumentStatus.Pending,
  })
  status!: DocumentStatus;

  /** Object-storage key of the uploaded file (never a public URL). */
  @Column({ type: 'varchar', length: 512 })
  fileKey!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  documentNumber!: string | null;

  @Column({ type: 'date', nullable: true })
  expiresOn!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn()
  reviewedBy!: User | null;

  @Column({ type: 'uuid', nullable: true })
  reviewedById!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  rejectionReason!: string | null;
}
