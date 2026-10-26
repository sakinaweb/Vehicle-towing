import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, Length, Matches, MaxLength, ValidateIf } from 'class-validator';

/** Trims surrounding whitespace and collapses inner runs of spaces. */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  );

/** Person name: 2–120 chars, letters (any script, incl. Arabic), spaces, apostrophes, dots, hyphens. */
export const OptionalPersonName = () =>
  applyDecorators(
    ApiPropertyOptional({ example: 'Rashid Al-Maktoum', minLength: 2, maxLength: 120 }),
    IsOptional(),
    Trim(),
    Length(2, 120),
    Matches(/^[\p{L}\p{M}][\p{L}\p{M} '.-]*$/u, {
      message: 'fullName may only contain letters, spaces, apostrophes, dots and hyphens',
    }),
  );

/** Email that may be cleared with null; stored lowercase. */
export const OptionalNullableEmail = () =>
  applyDecorators(
    ApiPropertyOptional({ example: 'rashid@example.ae', nullable: true, type: String }),
    IsOptional(),
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim().toLowerCase() : value,
    ),
    ValidateIf((_o, value) => value !== null),
    IsEmail({}, { message: 'email must be a valid email address' }),
    MaxLength(255),
  );
