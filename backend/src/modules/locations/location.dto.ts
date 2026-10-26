import { ApiProperty } from '@nestjs/swagger';
import { IsLatitude, IsLongitude, IsString, Length } from 'class-validator';
import { Trim } from '../../common/validation/string.decorators.js';

/** A point chosen by the customer (map pin or search result) with its readable address. */
export class LocationInputDto {
  @ApiProperty({ example: 25.1972, description: 'WGS84 latitude' })
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 55.2744, description: 'WGS84 longitude' })
  @IsLongitude()
  lng!: number;

  @ApiProperty({ example: 'Sheikh Zayed Rd, near Dubai Mall exit, Dubai' })
  @Trim()
  @IsString()
  @Length(3, 300)
  address!: string;
}

export class LocationView {
  @ApiProperty() lat!: number;
  @ApiProperty() lng!: number;
  @ApiProperty() address!: string;
}
