import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { IsEnum, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { DataSource } from 'typeorm';
import { BookingStatus, DisputeStatus, UserRole } from '../../common/enums.js';
import { Trim } from '../../common/validation/string.decorators.js';
import { RealtimeEmitter, RealtimeEvent } from '../../infrastructure/realtime/realtime.emitter.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, Roles } from '../auth/decorators.js';
import { Booking } from '../bookings/entities/booking.entity.js';
import { Customer } from '../customers/entities/customer.entity.js';
import { Driver } from '../drivers/entities/driver.entity.js';
import { isUniqueViolation } from '../users/users.service.js';
import { Dispute } from './entities/dispute.entity.js';

export class RaiseDisputeDto {
  @ApiProperty({ example: 'My bumper was scratched during loading.', minLength: 10 })
  @Trim()
  @IsString()
  @Length(10, 1000)
  reason!: string;
}

export class ResolveDisputeDto {
  @ApiProperty({ enum: [DisputeStatus.Resolved, DisputeStatus.Rejected] })
  @IsIn([DisputeStatus.Resolved, DisputeStatus.Rejected])
  status!: DisputeStatus.Resolved | DisputeStatus.Rejected;

  @ApiProperty({ example: 'Driver confirmed; repair cost agreed with the customer.' })
  @Trim()
  @IsString()
  @Length(5, 1000)
  resolution!: string;
}

export class DisputeQuery {
  @ApiPropertyOptional({ enum: DisputeStatus, default: DisputeStatus.Open })
  @IsOptional()
  @IsEnum(DisputeStatus)
  status: DisputeStatus = DisputeStatus.Open;
}

export class DisputeView {
  @ApiProperty() id!: string;
  @ApiProperty() bookingId!: string;
  @ApiProperty() bookingNumber!: string;
  @ApiProperty({ enum: UserRole }) raisedByRole!: UserRole;
  @ApiProperty() reason!: string;
  @ApiProperty({ enum: DisputeStatus }) status!: DisputeStatus;
  @ApiProperty({ nullable: true, type: String }) resolution!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ nullable: true, type: Date }) resolvedAt!: Date | null;
}

const view = (d: Dispute, bookingNumber: string): DisputeView => ({
  id: d.id,
  bookingId: d.bookingId,
  bookingNumber,
  raisedByRole: d.raisedByRole,
  reason: d.reason,
  status: d.status,
  resolution: d.resolution,
  createdAt: d.createdAt,
  resolvedAt: d.resolvedAt,
});

/** Disputes about a job. Raised by its customer or assigned driver; decided by operations. */
@ApiTags('Support')
@ApiBearerAuth()
@Controller()
export class SupportController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly emitter: RealtimeEmitter,
  ) {}

  @Post('bookings/:bookingId/disputes')
  @Roles(UserRole.Customer, UserRole.Driver)
  @ApiOperation({ summary: 'Raise a dispute about a job I was part of' })
  @ApiCreatedResponse({ type: DisputeView })
  @ApiConflictResponse({ description: 'A dispute is already open, or no driver was involved' })
  async raise(
    @CurrentAuth() auth: AuthContext,
    @Param('bookingId', new ParseUUIDPipe()) bookingId: string,
    @Body() dto: RaiseDisputeDto,
  ): Promise<DisputeView> {
    const booking = await this.participantBooking(auth, bookingId);
    if (!booking.driverId || booking.status === BookingStatus.Searching) {
      throw new ConflictException('Disputes can be raised once a driver was assigned.');
    }
    let dispute: Dispute;
    try {
      dispute = await this.dataSource.manager.save(
        this.dataSource.manager.create(Dispute, {
          bookingId,
          raisedById: auth.userId,
          raisedByRole: auth.role,
          reason: dto.reason,
        }),
      );
    } catch (err) {
      if (isUniqueViolation(err, 'uq_disputes_open_booking')) {
        throw new ConflictException('A dispute about this job is already open.');
      }
      throw err;
    }
    await this.audit.record({
      action: 'dispute.raised',
      entityType: 'booking',
      entityId: bookingId,
      actorUserId: auth.userId,
      metadata: { disputeId: dispute.id },
    });
    return view(dispute, booking.bookingNumber);
  }

  @Get('me/disputes')
  @Roles(UserRole.Customer, UserRole.Driver)
  @ApiOperation({ summary: 'Disputes I raised, newest first' })
  @ApiOkResponse({ type: [DisputeView] })
  async mine(@CurrentAuth() auth: AuthContext): Promise<DisputeView[]> {
    const rows = await this.dataSource.manager.find(Dispute, {
      where: { raisedById: auth.userId },
      relations: { booking: true },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return rows.map((d) => view(d, d.booking.bookingNumber));
  }

  @Get('admin/disputes')
  @Roles(UserRole.Admin)
  @ApiOperation({ summary: 'Disputes by status (default: open), oldest first' })
  @ApiOkResponse({ type: [DisputeView] })
  async list(@Query() q: DisputeQuery): Promise<DisputeView[]> {
    const rows = await this.dataSource.manager.find(Dispute, {
      where: { status: q.status },
      relations: { booking: true },
      order: { createdAt: q.status === DisputeStatus.Open ? 'ASC' : 'DESC' },
      take: 100,
    });
    return rows.map((d) => view(d, d.booking.bookingNumber));
  }

  @Post('admin/disputes/:id/resolve')
  @Roles(UserRole.Admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record the decision on an open dispute (audited)' })
  @ApiOkResponse({ type: DisputeView })
  @ApiConflictResponse({ description: 'Already decided' })
  async resolve(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ResolveDisputeDto,
  ): Promise<DisputeView> {
    const dispute = await this.dataSource.transaction(async (em) => {
      const d = await em.findOne(Dispute, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!d) throw new NotFoundException('Dispute not found.');
      if (d.status !== DisputeStatus.Open) {
        throw new ConflictException('This dispute was already decided.');
      }
      Object.assign(d, {
        status: dto.status,
        resolution: dto.resolution,
        resolvedById: auth.userId,
        resolvedAt: new Date(),
      });
      return em.save(d);
    });
    const booking = await this.dataSource.manager.findOneByOrFail(Booking, {
      id: dispute.bookingId,
    });
    await this.audit.record({
      action: `dispute.${dto.status}`,
      entityType: 'booking',
      entityId: dispute.bookingId,
      actorUserId: auth.userId,
      metadata: { disputeId: id, resolution: dto.resolution },
    });
    this.emitter.toUser(dispute.raisedById, RealtimeEvent.DisputeUpdated, {
      disputeId: id,
      bookingId: dispute.bookingId,
      bookingNumber: booking.bookingNumber,
      status: dispute.status,
    });
    return view(dispute, booking.bookingNumber);
  }

  /** The booking if the caller is its customer or its assigned driver; 404 otherwise. */
  private async participantBooking(auth: AuthContext, bookingId: string): Promise<Booking> {
    const em = this.dataSource.manager;
    const booking = await em.findOneBy(Booking, { id: bookingId });
    const mine =
      booking &&
      (auth.role === UserRole.Customer
        ? (await em.findOneBy(Customer, { userId: auth.userId }))?.id === booking.customerId
        : !!booking.driverId &&
          (await em.findOneBy(Driver, { userId: auth.userId }))?.id === booking.driverId);
    if (!booking || !mine) throw new NotFoundException('Booking not found.');
    return booking;
  }
}
