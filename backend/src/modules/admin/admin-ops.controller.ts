import {
  Body,
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
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { DataSource } from 'typeorm';
import { BookingStatus, UserRole } from '../../common/enums.js';
import { Trim } from '../../common/validation/string.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, Roles } from '../auth/decorators.js';
import { BookingView, CancelBookingDto, StatusChangeView } from '../bookings/booking.dto.js';
import { BookingsService } from '../bookings/bookings.service.js';

export const ADMIN_BOOKING_FILTERS = ['active', 'completed', 'cancelled', 'all'] as const;

export class AdminBookingsQuery {
  @ApiPropertyOptional({ enum: ADMIN_BOOKING_FILTERS, default: 'active' })
  @IsOptional()
  @IsIn(ADMIN_BOOKING_FILTERS)
  status: (typeof ADMIN_BOOKING_FILTERS)[number] = 'active';

  @ApiPropertyOptional({ description: 'Booking number or phone (partial match)' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(40)
  q?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;
}

export class OverviewView {
  @ApiProperty({ description: 'Open jobs per status' }) activeByStatus!: Record<string, number>;
  @ApiProperty() driversOnline!: number;
  @ApiProperty() driversPendingKyc!: number;
  @ApiProperty() openDisputes!: number;
  @ApiProperty({ description: 'Completed since 00:00 UAE time' }) completedToday!: number;
  @ApiProperty({ description: 'Fare total (incl. VAT) of those, fils' }) grossTodayFils!: number;
  @ApiProperty({ description: 'Sum of negative driver balances, fils' })
  commissionOwedFils!: number;
  @ApiProperty() totalBookings!: number;
  @ApiProperty() completedBookings!: number;
  @ApiProperty() cancelledBookings!: number;
  @ApiProperty({ description: 'All completed jobs, fare incl. VAT, fils' })
  grossAllTimeFils!: number;
  @ApiProperty({ description: 'VAT on completed jobs, fils' }) vatAllTimeFils!: number;
  @ApiProperty({
    description:
      'Commission earned on completed jobs: fare excl. VAT minus driver trip earnings, fils',
  })
  commissionEarnedFils!: number;
}

export class AdminBookingRow {
  @ApiProperty() id!: string;
  @ApiProperty() bookingNumber!: string;
  @ApiProperty({ enum: BookingStatus }) status!: BookingStatus;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() customerPhone!: string;
  @ApiProperty({ nullable: true, type: String }) customerName!: string | null;
  @ApiProperty({ nullable: true, type: String }) driverId!: string | null;
  @ApiProperty({ nullable: true, type: String }) driverName!: string | null;
  @ApiProperty({ nullable: true, type: String }) driverPhone!: string | null;
  @ApiProperty() pickupAddress!: string;
  @ApiProperty() dropoffAddress!: string;
  @ApiProperty() totalFils!: number;
  @ApiProperty() paymentMethod!: string;
  @ApiProperty({ nullable: true, type: Number }) customerRating!: number | null;
}

export class AdminBookingList {
  @ApiProperty({ type: [AdminBookingRow] }) items!: AdminBookingRow[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}

export class AdminBookingDetail {
  @ApiProperty({ type: AdminBookingRow }) summary!: AdminBookingRow;
  @ApiProperty({ type: [StatusChangeView] }) history!: StatusChangeView[];
  @ApiProperty({ nullable: true, type: String }) invoiceNumber!: string | null;
  @ApiProperty({ nullable: true, type: String }) paymentStatus!: string | null;
  @ApiProperty() inspections!: number;
  @ApiProperty({ nullable: true, type: String }) customerReview!: string | null;
  @ApiProperty({ nullable: true, type: String }) cancellationReason!: string | null;
}

const STATUS_SQL: Record<AdminBookingsQuery['status'], string> = {
  active: "b.status NOT IN ('completed', 'cancelled')",
  completed: "b.status = 'completed'",
  cancelled: "b.status = 'cancelled'",
  all: 'TRUE',
};

const ROW_SELECT = `
  SELECT b.id, b.booking_number, b.status, b.created_at, cu.phone AS customer_phone,
         cu.full_name AS customer_name, b.driver_id, du.full_name AS driver_name,
         du.phone AS driver_phone, b.pickup_address, b.dropoff_address, b.total_fils,
         b.payment_method, b.customer_rating, b.customer_review, b.cancellation_reason
    FROM bookings b
    JOIN customers c ON c.id = b.customer_id
    JOIN users cu ON cu.id = c.user_id
    LEFT JOIN drivers d ON d.id = b.driver_id
    LEFT JOIN users du ON du.id = d.user_id`;

type Row = Record<string, unknown> & {
  id: string;
  customer_review: string | null;
  cancellation_reason: string | null;
};
const toRow = (r: Row): AdminBookingRow => ({
  id: r.id,
  bookingNumber: r.booking_number as string,
  status: r.status as BookingStatus,
  createdAt: r.created_at as Date,
  customerPhone: r.customer_phone as string,
  customerName: r.customer_name as string | null,
  driverId: r.driver_id as string | null,
  driverName: r.driver_name as string | null,
  driverPhone: r.driver_phone as string | null,
  pickupAddress: r.pickup_address as string,
  dropoffAddress: r.dropoff_address as string,
  totalFils: Number(r.total_fils),
  paymentMethod: r.payment_method as string,
  customerRating: r.customer_rating as number | null,
});

/** Operations: live job monitoring and intervention. Admin only; every action audited. */
@ApiTags('Admin · Operations')
@ApiBearerAuth()
@Roles(UserRole.Admin)
@Controller('admin')
export class AdminOpsController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly bookings: BookingsService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Dashboard counters' })
  @ApiOkResponse({ type: OverviewView })
  async overview(): Promise<OverviewView> {
    const q = (sql: string) => this.dataSource.query<Record<string, string>[]>(sql);
    const [byStatus, [drivers], [disputes], [today], [owed], [totals]] = await Promise.all([
      q(`SELECT status, COUNT(*) AS n FROM bookings
          WHERE status NOT IN ('completed', 'cancelled') GROUP BY status`),
      q(`SELECT COUNT(*) FILTER (WHERE availability <> 'offline' AND kyc_status = 'approved') AS online,
                COUNT(*) FILTER (WHERE kyc_status = 'pending') AS pending FROM drivers`),
      q("SELECT COUNT(*) AS n FROM disputes WHERE status = 'open'"),
      q(`SELECT COUNT(*) AS n, COALESCE(SUM(total_fils), 0) AS gross FROM bookings
          WHERE status = 'completed'
            AND completed_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Dubai') AT TIME ZONE 'Asia/Dubai'`),
      q(`SELECT COALESCE(SUM(-balance), 0) AS owed FROM (
           SELECT SUM(amount_fils) AS balance FROM driver_ledger_entries GROUP BY driver_id) s
          WHERE balance < 0`),
      q(`SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE b.status = 'completed') AS completed,
                COUNT(*) FILTER (WHERE b.status = 'cancelled') AS cancelled,
                COALESCE(SUM(b.total_fils) FILTER (WHERE b.status = 'completed'), 0) AS gross,
                COALESCE(SUM(b.vat_fils) FILTER (WHERE b.status = 'completed'), 0) AS vat,
                COALESCE(SUM(b.subtotal_fils) FILTER (WHERE b.status = 'completed'), 0)
                  - COALESCE((SELECT SUM(amount_fils) FROM driver_ledger_entries WHERE type = 'trip_earning'), 0)
                  AS commission
           FROM bookings b`),
    ]);
    return {
      activeByStatus: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])),
      driversOnline: Number(drivers.online),
      driversPendingKyc: Number(drivers.pending),
      openDisputes: Number(disputes.n),
      completedToday: Number(today.n),
      grossTodayFils: Number(today.gross),
      commissionOwedFils: Number(owed.owed),
      totalBookings: Number(totals.total),
      completedBookings: Number(totals.completed),
      cancelledBookings: Number(totals.cancelled),
      grossAllTimeFils: Number(totals.gross),
      vatAllTimeFils: Number(totals.vat),
      commissionEarnedFils: Number(totals.commission),
    };
  }

  @Get('bookings')
  @ApiOperation({ summary: 'Jobs (default: open ones), newest first' })
  @ApiOkResponse({ type: AdminBookingList })
  async list(@Query() query: AdminBookingsQuery): Promise<AdminBookingList> {
    const params: unknown[] = [];
    let where = STATUS_SQL[query.status];
    if (query.q) {
      params.push(`%${query.q.replace(/[%_\\]/g, '\\$&')}%`);
      where += ` AND (b.booking_number ILIKE $1 OR cu.phone LIKE $1 OR du.phone LIKE $1)`;
    }
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM (${ROW_SELECT} WHERE ${where}) x`,
      params,
    );
    const rows: Row[] = await this.dataSource.query(
      `${ROW_SELECT} WHERE ${where} ORDER BY b.created_at DESC
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      params,
    );
    return { items: rows.map(toRow), total: Number(total), page: query.page, limit: query.limit };
  }

  @Get('bookings/:id')
  @ApiOperation({ summary: 'One job with its full timeline' })
  @ApiOkResponse({ type: AdminBookingDetail })
  async detail(@Param('id', new ParseUUIDPipe()) id: string): Promise<AdminBookingDetail> {
    const [row]: Row[] = await this.dataSource.query(`${ROW_SELECT} WHERE b.id = $1`, [id]);
    if (!row) throw new NotFoundException('Booking not found.');
    const [history, [extra]] = await Promise.all([
      this.dataSource.query<
        {
          from_status: BookingStatus | null;
          to_status: BookingStatus;
          note: string | null;
          created_at: Date;
        }[]
      >(
        `SELECT from_status, to_status, note, created_at FROM booking_status_history
          WHERE booking_id = $1 ORDER BY created_at`,
        [id],
      ),
      this.dataSource.query<
        { invoice_number: string | null; payment_status: string | null; inspections: string }[]
      >(
        `SELECT (SELECT invoice_number FROM invoices WHERE booking_id = $1) AS invoice_number,
                (SELECT status FROM payments WHERE booking_id = $1) AS payment_status,
                (SELECT COUNT(*) FROM booking_inspections WHERE booking_id = $1) AS inspections`,
        [id],
      ),
    ]);
    return {
      summary: toRow(row),
      history: history.map((h) => ({
        fromStatus: h.from_status,
        toStatus: h.to_status,
        note: h.note,
        at: h.created_at,
      })),
      invoiceNumber: extra.invoice_number,
      paymentStatus: extra.payment_status,
      inspections: Number(extra.inspections),
      customerReview: row.customer_review,
      cancellationReason: row.cancellation_reason,
    };
  }

  @Post('bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an open job at any stage (releases the driver; audited)' })
  @ApiOkResponse({ type: BookingView })
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelBookingDto,
  ): Promise<BookingView> {
    return this.bookings.cancelByAdmin(auth.userId, id, dto.reason);
  }
}
