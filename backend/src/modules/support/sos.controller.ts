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
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { DataSource, In } from 'typeorm';
import { SosStatus, UserRole, UserStatus } from '../../common/enums.js';
import { maskPhone } from '../../common/phone.js';
import { Trim } from '../../common/validation/string.decorators.js';
import { RealtimeEmitter, RealtimeEvent } from '../../infrastructure/realtime/realtime.emitter.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, Roles } from '../auth/decorators.js';
import { Booking } from '../bookings/entities/booking.entity.js';
import { Customer } from '../customers/entities/customer.entity.js';
import { Driver } from '../drivers/entities/driver.entity.js';
import { User } from '../users/entities/user.entity.js';
import { SosAlert } from './entities/sos-alert.entity.js';
import { Logger } from '@nestjs/common';

export class RaiseSosDto {
  @ApiPropertyOptional({ description: 'The job it concerns, if any (must be mine)' })
  @IsOptional()
  @IsUUID()
  bookingId?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100_000)
  accuracyMeters?: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 500)
  note?: string;
}

export class HandleSosDto {
  @ApiPropertyOptional({ maxLength: 500, description: 'What was done (resolve only)' })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 500)
  resolution?: string;
}

export class SosQuery {
  @ApiPropertyOptional({ enum: SosStatus })
  @IsOptional()
  @IsEnum(SosStatus)
  status?: SosStatus;
}

export class SosView {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: SosStatus }) status!: SosStatus;
  @ApiProperty({ enum: UserRole }) raisedByRole!: UserRole;
  @ApiProperty() raisedByPhone!: string;
  @ApiProperty({ nullable: true, type: String }) raisedByName!: string | null;
  @ApiProperty({ nullable: true, type: String }) bookingId!: string | null;
  @ApiProperty({ nullable: true, type: String }) bookingNumber!: string | null;
  @ApiProperty({ nullable: true, type: Number }) lat!: number | null;
  @ApiProperty({ nullable: true, type: Number }) lng!: number | null;
  @ApiProperty({ nullable: true, type: Number }) accuracyMeters!: number | null;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty({ nullable: true, type: String }) resolution!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ nullable: true, type: Date }) acknowledgedAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) resolvedAt!: Date | null;
}

/**
 * SOS from the apps → saved, every active admin alerted in real time (socket + inbox/push),
 * and handled from the admin panel. Calling 999 stays the first action in the apps.
 */
@ApiTags('SOS')
@ApiBearerAuth()
@Controller()
export class SosController {
  private readonly logger = new Logger('SOS');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly emitter: RealtimeEmitter,
  ) {}

  @Post('sos')
  @Roles(UserRole.Customer, UserRole.Driver)
  @ApiOperation({ summary: 'Raise an SOS (location and job optional)' })
  @ApiCreatedResponse({ type: SosView })
  async raise(@CurrentAuth() auth: AuthContext, @Body() dto: RaiseSosDto): Promise<SosView> {
    const em = this.dataSource.manager;
    if (dto.bookingId && !(await this.isMyBooking(auth, dto.bookingId))) {
      throw new NotFoundException('Booking not found.');
    }
    const alert = await em.save(
      em.create(SosAlert, {
        raisedById: auth.userId,
        raisedByRole: auth.role,
        bookingId: dto.bookingId ?? null,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
        accuracyMeters: dto.accuracyMeters ?? null,
        note: dto.note ?? null,
      }),
    );
    await this.audit.record({
      action: 'sos.raised',
      entityType: 'sos_alert',
      entityId: alert.id,
      actorUserId: auth.userId,
      metadata: { bookingId: alert.bookingId, hasLocation: alert.lat != null },
    });
    const [view] = await this.views({ id: alert.id });
    const admins = await em.find(User, {
      where: { role: UserRole.Admin, status: UserStatus.Active },
      select: { id: true },
    });
    for (const a of admins) this.emitter.toUser(a.id, RealtimeEvent.SosNew, view);
    this.logger.warn(
      `SOS ${alert.id} from ${auth.role} ${maskPhone(view.raisedByPhone)} — ${admins.length} admin(s) alerted`,
    );
    return view;
  }

  @Get('me/sos')
  @Roles(UserRole.Customer, UserRole.Driver)
  @ApiOperation({ summary: 'My SOS alerts, newest first' })
  @ApiOkResponse({ type: [SosView] })
  mine(@CurrentAuth() auth: AuthContext): Promise<SosView[]> {
    return this.views({ raisedById: auth.userId });
  }

  @Get('admin/sos')
  @Roles(UserRole.Admin)
  @ApiOperation({ summary: 'SOS alerts (default: not yet resolved), newest first' })
  @ApiOkResponse({ type: [SosView] })
  list(@Query() q: SosQuery): Promise<SosView[]> {
    return this.views({ status: q.status });
  }

  @Post('admin/sos/:id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.Admin)
  @ApiOkResponse({ type: SosView })
  acknowledge(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<SosView> {
    return this.transition(auth, id, SosStatus.Acknowledged, undefined);
  }

  @Post('admin/sos/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.Admin)
  @ApiOkResponse({ type: SosView })
  resolve(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: HandleSosDto,
  ): Promise<SosView> {
    return this.transition(auth, id, SosStatus.Resolved, dto.resolution);
  }

  private async transition(
    auth: AuthContext,
    id: string,
    to: SosStatus,
    resolution: string | undefined,
  ): Promise<SosView> {
    const now = new Date();
    const from =
      to === SosStatus.Resolved ? [SosStatus.Open, SosStatus.Acknowledged] : [SosStatus.Open];
    const result = await this.dataSource.manager.update(
      SosAlert,
      { id, status: In(from) },
      {
        status: to,
        handledById: auth.userId,
        ...(to === SosStatus.Acknowledged ? { acknowledgedAt: now } : { resolvedAt: now }),
        ...(resolution !== undefined && { resolution }),
      },
    );
    if (!result.affected) {
      const exists = await this.dataSource.manager.existsBy(SosAlert, { id });
      if (!exists) throw new NotFoundException('SOS not found.');
      throw new ConflictException(
        `This SOS is already ${to === SosStatus.Resolved ? 'resolved' : 'acknowledged or resolved'}.`,
      );
    }
    await this.audit.record({
      action: `sos.${to}`,
      entityType: 'sos_alert',
      entityId: id,
      actorUserId: auth.userId,
      metadata: resolution ? { resolution } : {},
    });
    const [view] = await this.views({ id });
    const alert = await this.dataSource.manager.findOneByOrFail(SosAlert, { id });
    this.emitter.toUser(alert.raisedById, RealtimeEvent.SosUpdated, view);
    return view;
  }

  private async isMyBooking(auth: AuthContext, bookingId: string): Promise<boolean> {
    const em = this.dataSource.manager;
    const booking = await em.findOneBy(Booking, { id: bookingId });
    if (!booking) return false;
    if (auth.role === UserRole.Customer) {
      return (await em.findOneBy(Customer, { userId: auth.userId }))?.id === booking.customerId;
    }
    return (
      !!booking.driverId &&
      (await em.findOneBy(Driver, { userId: auth.userId }))?.id === booking.driverId
    );
  }

  /** Default list (no filter): open + acknowledged. */
  private async views(f: {
    id?: string;
    raisedById?: string;
    status?: SosStatus;
  }): Promise<SosView[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (f.id) where.push(`s.id = $${params.push(f.id)}`);
    if (f.raisedById) where.push(`s.raised_by_id = $${params.push(f.raisedById)}`);
    if (f.status) where.push(`s.status = $${params.push(f.status)}`);
    else if (!f.id && !f.raisedById) where.push(`s.status <> 'resolved'`);
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT s.*, u.phone, u.full_name AS name, b.booking_number
         FROM sos_alerts s
         JOIN users u ON u.id = s.raised_by_id
         LEFT JOIN bookings b ON b.id = s.booking_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY s.created_at DESC LIMIT 200`,
      params,
    );
    return rows.map((r) => ({
      id: r.id as string,
      status: r.status as SosStatus,
      raisedByRole: r.raised_by_role as UserRole,
      raisedByPhone: r.phone as string,
      raisedByName: (r.name as string | null) ?? null,
      bookingId: (r.booking_id as string | null) ?? null,
      bookingNumber: (r.booking_number as string | null) ?? null,
      lat: (r.lat as number | null) ?? null,
      lng: (r.lng as number | null) ?? null,
      accuracyMeters: (r.accuracy_meters as number | null) ?? null,
      note: (r.note as string | null) ?? null,
      resolution: (r.resolution as string | null) ?? null,
      createdAt: r.created_at as Date,
      acknowledgedAt: (r.acknowledged_at as Date | null) ?? null,
      resolvedAt: (r.resolved_at as Date | null) ?? null,
    }));
  }
}
