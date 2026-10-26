import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { FuelLevel, InspectionStage, PhotoSlot } from '../../common/enums.js';
import type { ChecklistResult } from './entities/booking-inspection.entity.js';

const RESULTS: ChecklistResult[] = ['ok', 'damaged'];

/** Condition of each part of the vehicle: "ok" or "damaged" (describe damage in notes/photos). */
export class ChecklistDto {
  @ApiProperty({ enum: RESULTS }) @IsIn(RESULTS) body!: ChecklistResult;
  @ApiProperty({ enum: RESULTS }) @IsIn(RESULTS) glass!: ChecklistResult;
  @ApiProperty({ enum: RESULTS }) @IsIn(RESULTS) lights!: ChecklistResult;
  @ApiProperty({ enum: RESULTS }) @IsIn(RESULTS) tyres!: ChecklistResult;
  @ApiProperty({ enum: RESULTS }) @IsIn(RESULTS) mirrors!: ChecklistResult;
  @ApiProperty({ enum: RESULTS }) @IsIn(RESULTS) interior!: ChecklistResult;
}

export class InspectionDetailsDto {
  @ApiProperty({ example: 45120, description: 'Odometer reading in km' })
  @IsInt()
  @Min(0)
  @Max(2_000_000)
  odometerKm!: number;

  @ApiProperty({ enum: FuelLevel })
  @IsEnum(FuelLevel)
  fuelLevel!: FuelLevel;

  @ApiProperty({ type: ChecklistDto })
  @ValidateNested()
  @Type(() => ChecklistDto)
  checklist!: ChecklistDto;

  @ApiPropertyOptional({ example: 'Scratch on rear bumper, already present' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class PhotoUploadDto {
  @ApiProperty({ enum: PhotoSlot, description: 'Which angle this photo shows' })
  @IsEnum(PhotoSlot)
  slot!: PhotoSlot;
}

/** OpenAPI body of the multipart photo upload (the file itself is not a DTO property). */
export const PHOTO_UPLOAD_SCHEMA = {
  type: 'object',
  required: ['slot', 'file'],
  properties: {
    slot: { type: 'string', enum: Object.values(PhotoSlot) },
    file: { type: 'string', format: 'binary', description: 'JPEG, PNG, WebP or HEIC, up to 8 MB' },
  },
};

export class InspectionPhotoView {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: PhotoSlot }) slot!: PhotoSlot;
  @ApiProperty({ example: 'image/jpeg' }) contentType!: string;
  @ApiProperty() sizeBytes!: number;
  @ApiProperty() uploadedAt!: Date;
}

export class InspectionView {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: InspectionStage }) stage!: InspectionStage;
  @ApiProperty() odometerKm!: number;
  @ApiProperty({ enum: FuelLevel }) fuelLevel!: FuelLevel;
  @ApiProperty({ type: ChecklistDto }) checklist!: Record<string, ChecklistResult>;
  @ApiPropertyOptional({ nullable: true, type: String }) notes!: string | null;
  @ApiPropertyOptional({ nullable: true, type: Date, description: 'Null while still a draft' })
  submittedAt!: Date | null;
  @ApiProperty({ type: [InspectionPhotoView] }) photos!: InspectionPhotoView[];
}

export class InspectionListView {
  @ApiProperty({ type: [InspectionView] }) inspections!: InspectionView[];
}
