import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DataSource } from 'typeorm';
import { UserRole } from '../../common/enums.js';
import { Trim } from '../../common/validation/string.decorators.js';
import { Roles } from '../auth/decorators.js';

class PageQuery {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;
}

export class DriverLocationsQuery {
  @ApiPropertyOptional({ description: 'Include offline drivers (last known position)' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  all: boolean = false;
}

export class PaymentsQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['cash', 'card', 'apple_pay'] })
  @IsOptional()
  @IsIn(['cash', 'card', 'apple_pay'])
  method?: string;

  @ApiPropertyOptional({ description: 'Payment status, e.g. captured, pending, refunded' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  status?: string;

  @ApiPropertyOptional({ description: 'First day (UAE time), YYYY-MM-DD — by paid date' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ description: 'Last day (UAE time, inclusive), YYYY-MM-DD' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

export class AuditQuery extends PageQuery {
  @ApiPropertyOptional({ description: 'Action prefix, e.g. "sos" or "auth.sign_in"' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(60)
  action?: string;
}

const num = (v: unknown) => (v == null ? null : Number(v));

/** Read-only operational views for the admin panel: live map, money, audit trail. */
@ApiTags('Admin · Insights')
@ApiBearerAuth()
@Roles(UserRole.Admin)
@Controller('admin')
export class AdminInsightsController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get('driver-locations')
  @ApiOperation({ summary: 'Drivers on the map: online ones (or all with ?all=true)' })
  async driverLocations(@Query() q: DriverLocationsQuery) {
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT d.id, u.full_name, u.phone, d.availability, d.location_updated_at,
              ST_Y(d.current_location::geometry) AS lat, ST_X(d.current_location::geometry) AS lng,
              (SELECT b.booking_number FROM bookings b WHERE b.driver_id = d.id
                  AND b.status IN ('driver_assigned','driver_arriving','driver_arrived','vehicle_loaded','in_transit')
                ORDER BY b.created_at DESC LIMIT 1) AS active_booking
         FROM drivers d JOIN users u ON u.id = d.user_id
        WHERE d.current_location IS NOT NULL AND d.kyc_status = 'approved'
          ${q.all ? '' : `AND d.availability <> 'offline'`}
        ORDER BY d.location_updated_at DESC NULLS LAST`,
    );
    return rows.map((r) => ({
      driverId: r.id,
      fullName: r.full_name ?? null,
      phone: r.phone,
      availability: r.availability,
      lat: num(r.lat),
      lng: num(r.lng),
      locationUpdatedAt: r.location_updated_at ?? null,
      activeBookingNumber: r.active_booking ?? null,
    }));
  }

  @Get('payments')
  @ApiOperation({
    summary: 'Payments with the VAT / driver earning / platform commission split, newest first',
  })
  async payments(@Query() q: PaymentsQuery) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (q.method) where.push(`p.method = $${params.push(q.method)}`);
    if (q.status) where.push(`p.status = $${params.push(q.status)}`);
    // Calendar days in UAE time, by when the money moved (capture), else when it was created.
    const at = 'COALESCE(p.captured_at, p.created_at)';
    if (q.from) {
      where.push(`${at} >= ($${params.push(q.from)}::date AT TIME ZONE 'Asia/Dubai')`);
    }
    if (q.to) {
      where.push(`${at} < (($${params.push(q.to)}::date + 1) AT TIME ZONE 'Asia/Dubai')`);
    }
    const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const from = `FROM payments p
      JOIN bookings b ON b.id = p.booking_id
      JOIN customers c ON c.id = b.customer_id JOIN users cu ON cu.id = c.user_id
      LEFT JOIN drivers d ON d.id = b.driver_id LEFT JOIN users du ON du.id = d.user_id
      LEFT JOIN LATERAL (SELECT COALESCE(SUM(amount_fils), 0) AS earning FROM driver_ledger_entries
                          WHERE booking_id = b.id AND type = 'trip_earning') e ON true`;
    const [totals]: Record<string, string>[] = await this.dataSource.query(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(p.amount_fils) FILTER (WHERE p.status = 'captured'), 0) AS collected,
              COALESCE(SUM(b.vat_fils) FILTER (WHERE p.status = 'captured'), 0) AS vat,
              COALESCE(SUM(e.earning) FILTER (WHERE p.status = 'captured'), 0) AS earnings,
              COALESCE(SUM(b.subtotal_fils - e.earning) FILTER (WHERE p.status = 'captured' AND e.earning > 0), 0) AS commission
         ${from} ${sqlWhere}`,
      params,
    );
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT p.id, p.method, p.status, p.amount_fils, p.currency, p.provider, p.created_at,
              p.captured_at, p.refunded_at, b.id AS booking_id, b.booking_number, b.status AS booking_status,
              b.subtotal_fils, b.vat_fils, b.total_fils, e.earning,
              cu.phone AS customer_phone, cu.full_name AS customer_name,
              du.phone AS driver_phone, du.full_name AS driver_name
         ${from} ${sqlWhere}
        ORDER BY p.created_at DESC LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
      params,
    );
    return {
      totals: {
        count: Number(totals.n),
        collectedFils: Number(totals.collected),
        vatFils: Number(totals.vat),
        driverEarningsFils: Number(totals.earnings),
        commissionFils: Number(totals.commission),
      },
      items: rows.map((r) => {
        const earning = Number(r.earning);
        return {
          paymentId: r.id,
          bookingId: r.booking_id,
          bookingNumber: r.booking_number,
          bookingStatus: r.booking_status,
          method: r.method,
          status: r.status,
          amountFils: Number(r.amount_fils),
          currency: r.currency,
          subtotalFils: num(r.subtotal_fils),
          vatFils: num(r.vat_fils),
          driverEarningFils: earning || null,
          // Platform commission = subtotal − driver earning, once the trip has been settled.
          commissionFils: earning ? Number(r.subtotal_fils) - earning : null,
          customerPhone: r.customer_phone,
          customerName: r.customer_name ?? null,
          driverPhone: r.driver_phone ?? null,
          driverName: r.driver_name ?? null,
          createdAt: r.created_at,
          capturedAt: r.captured_at ?? null,
          refundedAt: r.refunded_at ?? null,
        };
      }),
      page: q.page,
      limit: q.limit,
    };
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'Audit trail, newest first (optionally filtered by action prefix)' })
  async auditLogs(@Query() q: AuditQuery) {
    const params: unknown[] = [];
    let where = '';
    if (q.action)
      where = `WHERE a.action LIKE $${params.push(`${q.action.replace(/[%_\\]/g, '\\$&')}%`)}`;
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM audit_logs a ${where}`,
      params,
    );
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.metadata, a.ip_address, a.created_at,
              u.phone AS actor_phone, u.role AS actor_role, u.full_name AS actor_name
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
        ${where} ORDER BY a.created_at DESC LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
      params,
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id ?? null,
        metadata: r.metadata ?? {},
        ip: r.ip_address ?? null,
        actorPhone: r.actor_phone ?? null,
        actorRole: r.actor_role ?? null,
        actorName: r.actor_name ?? null,
        createdAt: r.created_at,
      })),
      total: Number(total),
      page: q.page,
      limit: q.limit,
    };
  }
}
