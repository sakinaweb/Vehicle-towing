import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '../../common/enums.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, Roles } from '../auth/decorators.js';
import { CustomerProfileView, UpdateCustomerProfileDto } from './customer.dto.js';
import { CustomersService } from './customers.service.js';

@ApiTags('Customers')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Caller is not a customer' })
@Roles(UserRole.Customer)
@Controller('customers/me')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @ApiOperation({ summary: 'Get my customer profile' })
  @ApiOkResponse({ type: CustomerProfileView })
  get(@CurrentAuth() auth: AuthContext): Promise<CustomerProfileView> {
    return this.customers.getProfile(auth.userId);
  }

  @Patch()
  @ApiOperation({ summary: 'Update my name, email or default payment method' })
  @ApiOkResponse({ type: CustomerProfileView })
  update(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: UpdateCustomerProfileDto,
  ): Promise<CustomerProfileView> {
    return this.customers.updateProfile(auth.userId, dto);
  }
}
