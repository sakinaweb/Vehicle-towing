import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  BookingStatus,
  CancelledBy,
  PaymentMethod,
  TowType,
  VehicleIssue,
} from '../../common/enums.js';
import { Trim } from '../../common/validation/string.decorators.js';
import { LocationInputDto, LocationView } from '../locations/location.dto.js';
import { PaymentSummaryView } from '../payments/payment.dto.js';
import { CustomerVehicleView } from '../vehicles/vehicle.dto.js';

export class QuoteRequestDto {
  @ApiProperty({ format: 'uuid', description: 'One of my vehicles' })
  @IsUUID()
  vehicleId!: string;

  @ApiProperty({ enum: TowType })
  @IsEnum(TowType)
  towType!: TowType;

  @ApiProperty({ type: LocationInputDto })
  @ValidateNested()
  @Type(() => LocationInputDto)
  pickup!: LocationInputDto;

  @ApiProperty({ type: LocationInputDto })
  @ValidateNested()
  @Type(() => LocationInputDto)
  dropoff!: LocationInputDto;
}

export class FareView {
  @ApiProperty() baseFareFils!: number;
  @ApiProperty() distanceChargeFils!: number;
  @ApiProperty() towTypeSurchargeFils!: number;
  @ApiProperty({ description: '00:00–05:59 UAE time' }) nightSurchargeFils!: number;
  @ApiProperty() minimumFareAdjustmentFils!: number;
  @ApiProperty() subtotalFils!: number;
  @ApiProperty({ description: '500 = 5%' }) vatRateBps!: number;
  @ApiProperty() vatFils!: number;
  @ApiProperty() totalFils!: number;
  @ApiProperty({ example: 'AED' }) currency!: string;
}

export class QuoteView {
  @ApiProperty({ format: 'uuid', description: 'Pass to POST /bookings to book this exact price' })
  quoteId!: string;
  @ApiProperty() expiresAt!: Date;
  @ApiProperty({ format: 'uuid' }) vehicleId!: string;
  @ApiProperty({ enum: TowType }) towType!: TowType;
  @ApiProperty({ type: LocationView }) pickup!: LocationView;
  @ApiProperty({ type: LocationView }) dropoff!: LocationView;
  @ApiProperty() distanceMeters!: number;
  @ApiProperty() estimatedDurationSeconds!: number;
  @ApiProperty({ description: 'How the distance was obtained' }) distanceSource!: string;
  @ApiProperty({ type: FareView }) fare!: FareView;
}

export class CreateBookingDto {
  @ApiProperty({ format: 'uuid', description: 'From POST /bookings/quotes' })
  @IsUUID()
  quoteId!: string;

  @ApiProperty({ enum: VehicleIssue })
  @IsEnum(VehicleIssue)
  issue!: VehicleIssue;

  @ApiPropertyOptional({ example: 'Car is in basement B2, front bumper is low.' })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 500)
  notes?: string;

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;
}

export class CancelBookingDto {
  @ApiProperty({ example: 'Booked by mistake', minLength: 3, maxLength: 255 })
  @Trim()
  @IsString()
  @Length(3, 255)
  reason!: string;
}

export class RateBookingDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({ maxLength: 500, example: 'Quick and careful with my car.' })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 500)
  comment?: string;
}

export class BookingRatingView {
  @ApiProperty() rating!: number;
  @ApiProperty({ nullable: true, type: String }) comment!: string | null;
  @ApiProperty() ratedAt!: Date;
}

export const BOOKING_LIST_FILTERS = ['active', 'completed', 'cancelled'] as const;
export type BookingListFilter = (typeof BOOKING_LIST_FILTERS)[number];

export class ListBookingsQuery {
  @ApiPropertyOptional({ enum: BOOKING_LIST_FILTERS })
  @IsOptional()
  @IsIn(BOOKING_LIST_FILTERS)
  status?: BookingListFilter;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}

export class BookingFareView {
  @ApiProperty() baseFareFils!: number;
  @ApiProperty() distanceChargeFils!: number;
  @ApiProperty() towTypeChargeFils!: number;
  @ApiProperty({ description: 'Night surcharge + minimum-fare top-up' })
  additionalChargesFils!: number;
  @ApiProperty() subtotalFils!: number;
  @ApiProperty() vatRateBps!: number;
  @ApiProperty() vatFils!: number;
  @ApiProperty() totalFils!: number;
  @ApiProperty() currency!: string;
}

export class StatusChangeView {
  @ApiProperty({ enum: BookingStatus, nullable: true }) fromStatus!: BookingStatus | null;
  @ApiProperty({ enum: BookingStatus }) toStatus!: BookingStatus;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty() at!: Date;
}

export class AssignedTruckView {
  @ApiProperty({ enum: TowType }) towType!: TowType;
  @ApiProperty() model!: string;
  @ApiProperty() plateEmirate!: string;
  @ApiProperty() plateCode!: string;
  @ApiProperty() plateNumber!: string;
}

export class AssignedDriverView {
  @ApiProperty({ example: 'Tariq' }) firstName!: string;
  @ApiProperty({ nullable: true, type: Number }) rating!: number | null;
  @ApiProperty() totalTrips!: number;
  @ApiProperty({ type: AssignedTruckView }) truck!: AssignedTruckView;
}

export class BookingView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'TN-100001' }) bookingNumber!: string;
  @ApiProperty({ enum: BookingStatus }) status!: BookingStatus;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ type: CustomerVehicleView }) vehicle!: CustomerVehicleView;
  @ApiProperty({ enum: TowType }) towType!: TowType;
  @ApiProperty({ enum: VehicleIssue }) issue!: VehicleIssue;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
  @ApiProperty({ type: LocationView }) pickup!: LocationView;
  @ApiProperty({ type: LocationView }) dropoff!: LocationView;
  @ApiProperty() distanceMeters!: number;
  @ApiProperty({ nullable: true, type: Number }) estimatedDurationSeconds!: number | null;
  @ApiProperty({ type: BookingFareView }) fare!: BookingFareView;
  @ApiProperty({ enum: PaymentMethod }) paymentMethod!: PaymentMethod;
  @ApiProperty({ description: 'Whether the customer may cancel now' }) canCancel!: boolean;
  @ApiProperty({ description: 'A driver is already on the way' })
  cancellationFeeMayApply!: boolean;
  @ApiProperty({ nullable: true, type: Date }) cancelledAt!: Date | null;
  @ApiProperty({ enum: CancelledBy, nullable: true }) cancelledBy!: CancelledBy | null;
  @ApiProperty({ nullable: true, type: String }) cancellationReason!: string | null;
  @ApiProperty({ type: AssignedDriverView, nullable: true }) driver!: AssignedDriverView | null;
  @ApiProperty({
    type: PaymentSummaryView,
    nullable: true,
    description:
      'Card: from booking (pending until authorised). Cash: set when the driver confirms collection.',
  })
  payment!: PaymentSummaryView | null;
  @ApiProperty({ type: BookingRatingView, nullable: true, description: 'My rating, once given' })
  myRating!: BookingRatingView | null;
  @ApiPropertyOptional({ type: [StatusChangeView], description: 'Only on the details endpoint' })
  history?: StatusChangeView[];
}

export class BookingListView {
  @ApiProperty({ type: [BookingView] }) items!: BookingView[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
