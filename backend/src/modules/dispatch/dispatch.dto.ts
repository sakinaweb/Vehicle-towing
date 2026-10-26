import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import {
  BookingStatus,
  DriverAvailability,
  OfferStatus,
  PaymentMethod,
  TowType,
  VehicleCategory,
  VehicleIssue,
} from '../../common/enums.js';
import { LocationView } from '../locations/location.dto.js';

export class SetAvailabilityDto {
  @ApiProperty({ enum: ['online', 'offline'] })
  @IsIn([DriverAvailability.Online, DriverAvailability.Offline])
  status!: DriverAvailability.Online | DriverAvailability.Offline;
}

export class AvailabilityView {
  @ApiProperty({ enum: DriverAvailability }) availability!: DriverAvailability;
  @ApiProperty({ nullable: true, type: Date }) locationUpdatedAt!: Date | null;
}

export class LocationUpdateDto {
  @ApiProperty({ example: 25.2048 })
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 55.2708 })
  @IsLongitude()
  lng!: number;

  @ApiPropertyOptional({ description: 'When the device took the fix (ISO 8601); defaults to now' })
  @IsOptional()
  @IsISO8601({ strict: true })
  recordedAt?: string;

  @ApiPropertyOptional({ description: 'GPS accuracy radius, metres' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10_000)
  accuracyMeters?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 360 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  headingDegrees?: number;
}

export class LocationAcceptedView {
  @ApiProperty() lat!: number;
  @ApiProperty() lng!: number;
  @ApiProperty() recordedAt!: Date;
}

export class JobVehicleView {
  @ApiProperty({ enum: VehicleCategory }) category!: VehicleCategory;
  @ApiProperty() brand!: string;
  @ApiProperty() model!: string;
  @ApiProperty({ nullable: true, type: String }) color!: string | null;
  @ApiProperty({ example: 'Dubai A 12345' }) plate!: string;
}

/** What a driver sees about a job: no customer phone, email or surname. */
export class DriverJobView {
  @ApiProperty({ format: 'uuid' }) bookingId!: string;
  @ApiProperty() bookingNumber!: string;
  @ApiProperty({ enum: BookingStatus }) status!: BookingStatus;
  @ApiProperty({ enum: TowType }) towType!: TowType;
  @ApiProperty({ enum: VehicleIssue }) issue!: VehicleIssue;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
  @ApiProperty({ type: JobVehicleView }) vehicle!: JobVehicleView;
  @ApiProperty({ type: LocationView }) pickup!: LocationView;
  @ApiProperty({ type: LocationView }) dropoff!: LocationView;
  @ApiProperty() tripDistanceMeters!: number;
  @ApiProperty({ description: 'Customer pays (incl. VAT), fils' }) fareTotalFils!: number;
  @ApiProperty({ description: 'Estimated driver payout after commission, fils' })
  driverPayoutFils!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ example: 'Rashid' }) customerFirstName!: string;
  @ApiProperty({
    enum: PaymentMethod,
    description: 'cash = collect the total; card / apple_pay = never collect cash',
  })
  paymentMethod!: PaymentMethod;
  @ApiProperty({
    description: 'Inspection progress: none, draft (saved, not submitted) or submitted',
    example: { pickup: 'submitted', return: 'none' },
  })
  inspections!: { pickup: InspectionState; return: InspectionState };
}

export type InspectionState = 'none' | 'draft' | 'submitted';

export class CurrentOfferView {
  @ApiProperty({ type: () => OfferView, nullable: true }) offer!: OfferView | null;
}

export class CurrentJobView {
  @ApiProperty({ type: DriverJobView, nullable: true }) job!: DriverJobView | null;
}

export class OfferView extends DriverJobView {
  @ApiProperty({ format: 'uuid' }) offerId!: string;
  @ApiProperty({ enum: OfferStatus }) offerStatus!: OfferStatus;
  @ApiProperty({ description: 'Driver → pickup, metres' }) distanceToPickupMeters!: number;
  @ApiProperty() expiresAt!: Date;
}
