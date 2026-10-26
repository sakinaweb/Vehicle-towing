import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { DriverAvailability, Emirate, KycStatus, TowType } from '../../common/enums.js';
import {
  OptionalNullableEmail,
  OptionalPersonName,
  Trim,
} from '../../common/validation/string.decorators.js';
import type { User } from '../users/entities/user.entity.js';
import { UserView } from '../users/user.view.js';
import type { Driver } from './entities/driver.entity.js';
import type { TowTruck } from './entities/tow-truck.entity.js';

const MAX_YEAR = new Date().getFullYear() + 1;

export class UpdateDriverProfileDto {
  @OptionalPersonName()
  fullName?: string;

  @OptionalNullableEmail()
  email?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 60 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  experienceYears?: number;
}

export class CreateTowTruckDto {
  @ApiProperty({ enum: TowType })
  @IsEnum(TowType)
  towType!: TowType;

  @ApiProperty({ example: 'Isuzu NPR Hydraulic Flatbed' })
  @Trim()
  @IsString()
  @Length(2, 80)
  model!: string;

  @ApiProperty({ example: 2023, minimum: 1980, maximum: MAX_YEAR })
  @IsInt()
  @Min(1980)
  @Max(MAX_YEAR)
  year!: number;

  @ApiProperty({ enum: Emirate })
  @IsEnum(Emirate)
  plateEmirate!: Emirate;

  @ApiProperty({ example: 'A', description: 'Plate code / letter, 1–3 characters' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9]{1,3}$/, { message: 'plateCode must be 1–3 letters or digits' })
  plateCode!: string;

  @ApiProperty({ example: '89312', description: 'Plate number, 1–5 digits' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^\d{1,5}$/, { message: 'plateNumber must be 1–5 digits' })
  plateNumber!: string;
}

export class UpdateTowTruckDto extends PartialType(CreateTowTruckDto) {
  @ApiPropertyOptional({ description: 'Inactive trucks are not offered jobs' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class TowTruckView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: TowType }) towType!: TowType;
  @ApiProperty() model!: string;
  @ApiProperty() year!: number;
  @ApiProperty({ enum: Emirate }) plateEmirate!: Emirate;
  @ApiProperty() plateCode!: string;
  @ApiProperty() plateNumber!: string;
  @ApiProperty() isActive!: boolean;

  static from(t: TowTruck): TowTruckView {
    return {
      id: t.id,
      towType: t.towType,
      model: t.model,
      year: t.year,
      plateEmirate: t.plateEmirate,
      plateCode: t.plateCode,
      plateNumber: t.plateNumber,
      isActive: t.isActive,
    };
  }
}

export class DriverProfileView {
  @ApiProperty({ type: UserView }) user!: UserView;
  @ApiProperty({ enum: KycStatus }) kycStatus!: KycStatus;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Why KYC was rejected (fix and re-upload)',
  })
  kycRejectionReason!: string | null;
  @ApiProperty({ enum: DriverAvailability }) availability!: DriverAvailability;
  @ApiProperty({ nullable: true, type: Number }) rating!: number | null;
  @ApiProperty() totalTrips!: number;
  @ApiProperty() experienceYears!: number;
  @ApiProperty({ nullable: true, type: Number }) acceptanceRate!: number | null;
  @ApiProperty({ type: [TowTruckView] }) towTrucks!: TowTruckView[];

  static from(user: User, driver: Driver, trucks: TowTruck[]): DriverProfileView {
    return {
      user: UserView.from(user),
      kycStatus: driver.kycStatus,
      kycRejectionReason:
        driver.kycStatus === KycStatus.Rejected ? driver.kycRejectionReason : null,
      availability: driver.availability,
      rating: driver.rating,
      totalTrips: driver.totalTrips,
      experienceYears: driver.experienceYears,
      acceptanceRate: driver.acceptanceRate,
      towTrucks: trucks.map((t) => TowTruckView.from(t)),
    };
  }
}
