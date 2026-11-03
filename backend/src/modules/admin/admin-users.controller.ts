import {
  BadRequestException,
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
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { DataSource } from 'typeorm';
import { DriverAvailability, UserRole, UserStatus } from '../../common/enums.js';
import { Trim } from '../../common/validation/string.decorators.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, Roles } from '../auth/decorators.js';
import { TokenService } from '../auth/token.service.js';
import { Driver } from '../drivers/entities/driver.entity.js';
import { User } from '../users/entities/user.entity.js';

export class CustomersQuery {
  @ApiPropertyOptional({ description: 'Phone or name (partial match)' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(40)
  q?: string;

  @ApiPropertyOptional({ enum: ['active', 'suspended'] })
  @IsOptional()
  @IsIn(['active', 'suspended'])
  status?: 'active' | 'suspended';

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

export class UserStatusChangeDto {
  @ApiProperty({ example: 'Repeated fake bookings', description: 'Saved in the audit log' })
  @Trim()
  @IsString()
  @Length(3, 255)
  reason!: string;
}

/** Customer list and account suspension (customers and drivers; never admins). */
@ApiTags('Admin · Users')
@ApiBearerAuth()
@Roles(UserRole.Admin)
@Controller('admin')
export class AdminUsersController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  @Get('customers')
  @ApiOperation({ summary: 'Customers with booking counts and spend, newest first' })
  async customers(@Query() q: CustomersQuery) {
    const params: unknown[] = [];
    const where = ["u.role = 'customer'", "u.status <> 'deleted'"];
    if (q.status) where.push(`u.status = $${params.push(q.status)}`);
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, '\\$&')}%`;
      where.push(`(u.phone LIKE $${params.push(like)} OR u.full_name ILIKE $${params.length})`);
    }
    const sqlWhere = where.join(' AND ');
    const [{ total }]: { total: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM users u WHERE ${sqlWhere}`,
      params,
    );
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT u.id AS user_id, c.id AS customer_id, u.full_name, u.phone, u.email, u.status, u.created_at,
              COUNT(b.id) AS bookings,
              COUNT(b.id) FILTER (WHERE b.status = 'completed') AS completed,
              COUNT(b.id) FILTER (WHERE b.status NOT IN ('completed', 'cancelled')) AS active,
              COALESCE(SUM(b.total_fils) FILTER (WHERE b.status = 'completed'), 0) AS spent,
              MAX(b.created_at) AS last_booking_at
         FROM users u
         LEFT JOIN customers c ON c.user_id = u.id
         LEFT JOIN bookings b ON b.customer_id = c.id
        WHERE ${sqlWhere}
        GROUP BY u.id, c.id
        ORDER BY u.created_at DESC
        LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
      params,
    );
    return {
      items: rows.map((r) => ({
        userId: r.user_id,
        customerId: r.customer_id ?? null,
        fullName: r.full_name ?? null,
        phone: r.phone,
        email: r.email ?? null,
        status: r.status,
        createdAt: r.created_at,
        bookings: Number(r.bookings),
        completedBookings: Number(r.completed),
        activeBookings: Number(r.active),
        spentFils: Number(r.spent),
        lastBookingAt: r.last_booking_at ?? null,
      })),
      total: Number(total),
      page: q.page,
      limit: q.limit,
    };
  }

  @Post('users/:userId/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Suspend a customer or driver: signed out everywhere, cannot sign in again',
  })
  async suspend(
    @CurrentAuth() auth: AuthContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: UserStatusChangeDto,
  ) {
    const user = await this.target(auth, userId);
    if (user.status === UserStatus.Suspended) {
      throw new ConflictException('This account is already suspended.');
    }
    await this.dataSource.manager.update(User, { id: userId }, { status: UserStatus.Suspended });
    const sessionsEnded = await this.tokens.revokeAllSessions(userId);
    // A suspended driver must not receive new jobs; a job already under way is left to operations.
    await this.dataSource.manager.update(
      Driver,
      { userId, availability: DriverAvailability.Online },
      { availability: DriverAvailability.Offline },
    );
    await this.audit.record({
      action: 'user.suspended',
      entityType: 'user',
      entityId: userId,
      actorUserId: auth.userId,
      metadata: { reason: dto.reason, role: user.role, sessionsEnded },
    });
    return { userId, status: UserStatus.Suspended, sessionsEnded };
  }

  @Post('users/:userId/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivate a suspended customer or driver' })
  async reactivate(
    @CurrentAuth() auth: AuthContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: UserStatusChangeDto,
  ) {
    const user = await this.target(auth, userId);
    if (user.status !== UserStatus.Suspended) {
      throw new ConflictException('Only a suspended account can be reactivated.');
    }
    await this.dataSource.manager.update(User, { id: userId }, { status: UserStatus.Active });
    await this.audit.record({
      action: 'user.reactivated',
      entityType: 'user',
      entityId: userId,
      actorUserId: auth.userId,
      metadata: { reason: dto.reason, role: user.role },
    });
    return { userId, status: UserStatus.Active };
  }

  private async target(auth: AuthContext, userId: string): Promise<User> {
    const user = await this.dataSource.manager.findOneBy(User, { id: userId });
    if (!user || user.status === UserStatus.Deleted) throw new NotFoundException('User not found.');
    if (user.id === auth.userId)
      throw new BadRequestException('You cannot change your own account.');
    if (user.role !== UserRole.Customer && user.role !== UserRole.Driver) {
      throw new BadRequestException('Only customer and driver accounts can be suspended here.');
    }
    return user;
  }
}
