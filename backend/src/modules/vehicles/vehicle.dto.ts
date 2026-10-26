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
import { Emirate, VehicleCategory } from '../../common/enums.js';
import { Trim } from '../../common/validation/string.decorators.js';
import type { CustomerVehicle } from './entities/customer-vehicle.entity.js';

const MAX_YEAR = new Date().getFullYear() + 1;

export class CreateCustomerVehicleDto {
  @ApiProperty({ enum: VehicleCategory })
  @IsEnum(VehicleCategory)
  category!: VehicleCategory;

  @ApiProperty({ example: 'Toyota' })
  @Trim()
  @IsString()
  @Length(1, 60)
  brand!: string;

  @ApiProperty({ example: 'Land Cruiser' })
  @Trim()
  @IsString()
  @Length(1, 80)
  model!: string;

  @ApiProperty({ example: 2022, minimum: 1950, maximum: MAX_YEAR })
  @IsInt()
  @Min(1950)
  @Max(MAX_YEAR)
  year!: number;

  @ApiPropertyOptional({ example: 'Pearl White' })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 40)
  color?: string;

  @ApiProperty({ enum: Emirate })
  @IsEnum(Emirate)
  plateEmirate!: Emirate;

  @ApiProperty({ example: 'A', description: 'Plate code / letter, 1–3 letters or digits' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9]{1,3}$/, { message: 'plateCode must be 1–3 letters or digits' })
  plateCode!: string;

  @ApiProperty({ example: '12345', description: '1–5 digits' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^\d{1,5}$/, { message: 'plateNumber must be 1–5 digits' })
  plateNumber!: string;

  @ApiPropertyOptional({ description: 'Pre-selected when requesting a tow' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateCustomerVehicleDto extends PartialType(CreateCustomerVehicleDto) {}

export class CustomerVehicleView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: VehicleCategory }) category!: VehicleCategory;
  @ApiProperty() brand!: string;
  @ApiProperty() model!: string;
  @ApiProperty() year!: number;
  @ApiProperty({ nullable: true, type: String }) color!: string | null;
  @ApiProperty({ enum: Emirate }) plateEmirate!: Emirate;
  @ApiProperty() plateCode!: string;
  @ApiProperty() plateNumber!: string;
  @ApiProperty() isDefault!: boolean;
  @ApiProperty() createdAt!: Date;

  static from(v: CustomerVehicle): CustomerVehicleView {
    return {
      id: v.id,
      category: v.category,
      brand: v.brand,
      model: v.model,
      year: v.year,
      color: v.color,
      plateEmirate: v.plateEmirate,
      plateCode: v.plateCode,
      plateNumber: v.plateNumber,
      isDefault: v.isDefault,
      createdAt: v.createdAt,
    };
  }
}
