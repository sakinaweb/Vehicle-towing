import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude } from 'class-validator';
import { DataSource } from 'typeorm';
import { TowType, UserRole } from '../../common/enums.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { Roles } from '../auth/decorators.js';

export class NearbyQuery {
  @ApiProperty({ example: 25.1972 }) @Type(() => Number) @IsLatitude() lat!: number;
  @ApiProperty({ example: 55.2744 }) @Type(() => Number) @IsLongitude() lng!: number;
}

export class NearbyTypeView {
  @ApiProperty({ enum: TowType }) towType!: TowType;
  @ApiProperty({ description: 'Trucks that could be offered a job here right now' })
  available!: number;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Nearest one, rounded UP to 500 m (never an exact position)',
  })
  nearestMeters!: number | null;
}

export class NearbyView {
  @ApiProperty({ description: 'Search radius used by dispatch' }) radiusMeters!: number;
  @ApiProperty({ type: [NearbyTypeView] }) byTowType!: NearbyTypeView[];
}

/**
 * "How many tow trucks are near me?" for the customer home screen. Uses the same
 * eligibility as dispatch (approved, online, fresh GPS, idle, matching equipment) and
 * returns only counts and a coarse distance — drivers' positions are never exposed.
 */
@ApiTags('Bookings')
@ApiBearerAuth()
@Roles(UserRole.Customer)
@Controller('availability')
export class NearbyController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: AppConfigService,
  ) {}

  @Get('nearby')
  @ApiOperation({ summary: 'Available tow trucks near a point (counts only)' })
  @ApiOkResponse({ type: NearbyView })
  async nearby(@Query() q: NearbyQuery): Promise<NearbyView> {
    const { searchRadiusMeters, locationMaxAgeSeconds } = this.config.matching;
    const rows: { tow_type: TowType; available: string; nearest: number | null }[] =
      await this.dataSource.query(
        `SELECT t.tow_type, COUNT(DISTINCT d.id) AS available,
                MIN(ST_Distance(d.current_location, p.pt)) AS nearest
           FROM (SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS pt) p
           JOIN drivers d
             ON d.availability = 'online'
            AND d.kyc_status = 'approved'
            AND d.current_location IS NOT NULL
            AND d.location_updated_at > now() - make_interval(secs => $3)
            AND ST_DWithin(d.current_location, p.pt, $4)
           JOIN users u ON u.id = d.user_id AND u.status = 'active'
           JOIN tow_trucks t ON t.driver_id = d.id AND t.is_active
          WHERE NOT EXISTS (SELECT 1 FROM bookings ab
                             WHERE ab.driver_id = d.id AND ab.status NOT IN ('completed', 'cancelled'))
          GROUP BY t.tow_type`,
        [q.lng, q.lat, locationMaxAgeSeconds, searchRadiusMeters],
      );
    return {
      radiusMeters: searchRadiusMeters,
      byTowType: Object.values(TowType).map((towType) => {
        const r = rows.find((x) => x.tow_type === towType);
        return {
          towType,
          available: Number(r?.available ?? 0),
          nearestMeters: r?.nearest == null ? null : Math.ceil(r.nearest / 500) * 500,
        };
      }),
    };
  }
}
