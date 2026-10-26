import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';
import { normalizeIndiaMobile, normalizeUaeMobile } from '../phone.js';

const E164_UAE_MOBILE = /^\+9715[024568]\d{7}$/;
const E164_UAE_OR_INDIA_MOBILE = /^(\+9715[024568]\d{7}|\+91[6-9]\d{9})$/;

/**
 * Accepts any common UAE mobile format and hands the handler the E.164 form
 * (+9715XXXXXXXX). Invalid input is rejected with a readable message.
 * With devIndia, +91 numbers also pass here; OtpService only issues codes to them when
 * DEV_ALLOW_INDIA_PHONES is on (never in production).
 */
export const UaeMobile = ({ devIndia = false } = {}) =>
  applyDecorators(
    ApiProperty({ example: '+971501234567', description: 'UAE mobile number (any common format)' }),
    Transform(
      ({ value }: { value: unknown }) =>
        normalizeUaeMobile(value) ?? (devIndia ? normalizeIndiaMobile(value) : null) ?? value,
    ),
    Matches(devIndia ? E164_UAE_OR_INDIA_MOBILE : E164_UAE_MOBILE, {
      message: 'phone must be a valid UAE mobile number, e.g. 050 123 4567',
    }),
  );
