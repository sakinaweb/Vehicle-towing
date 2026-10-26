import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaymentMethod } from '../../common/enums.js';
import {
  OptionalNullableEmail,
  OptionalPersonName,
} from '../../common/validation/string.decorators.js';
import { UserView } from '../users/user.view.js';
import { Customer } from './entities/customer.entity.js';
import type { User } from '../users/entities/user.entity.js';

export class UpdateCustomerProfileDto {
  @OptionalPersonName()
  fullName?: string;

  @OptionalNullableEmail()
  email?: string | null;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  defaultPaymentMethod?: PaymentMethod;
}

export class CustomerProfileView {
  @ApiProperty({ type: UserView }) user!: UserView;
  @ApiProperty({ enum: PaymentMethod, nullable: true }) defaultPaymentMethod!: PaymentMethod | null;

  static from(user: User, customer: Customer): CustomerProfileView {
    return { user: UserView.from(user), defaultPaymentMethod: customer.defaultPaymentMethod };
  }
}
