import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '../../common/enums.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, Roles } from '../auth/decorators.js';
import { CustomerVehiclesService } from './customer-vehicles.service.js';
import {
  CreateCustomerVehicleDto,
  CustomerVehicleView,
  UpdateCustomerVehicleDto,
} from './vehicle.dto.js';

@ApiTags('Customer vehicles')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Caller is not a customer' })
@Roles(UserRole.Customer)
@Controller('customers/me/vehicles')
export class CustomerVehiclesController {
  constructor(private readonly vehicles: CustomerVehiclesService) {}

  @Get()
  @ApiOperation({ summary: 'List my vehicles (default first)' })
  @ApiOkResponse({ type: [CustomerVehicleView] })
  list(@CurrentAuth() auth: AuthContext): Promise<CustomerVehicleView[]> {
    return this.vehicles.list(auth.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Register a car or motorbike' })
  @ApiCreatedResponse({ type: CustomerVehicleView })
  @ApiConflictResponse({ description: 'Plate already registered, or vehicle limit reached' })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateCustomerVehicleDto,
  ): Promise<CustomerVehicleView> {
    return this.vehicles.create(auth.userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one of my vehicles' })
  @ApiOkResponse({ type: CustomerVehicleView })
  @ApiNotFoundResponse()
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<CustomerVehicleView> {
    return this.vehicles.get(auth.userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit one of my vehicles or make it the default' })
  @ApiOkResponse({ type: CustomerVehicleView })
  @ApiNotFoundResponse()
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCustomerVehicleDto,
  ): Promise<CustomerVehicleView> {
    return this.vehicles.update(auth.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove one of my vehicles (kept for booking history)' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Vehicle has an active tow request' })
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.vehicles.remove(auth.userId, id);
  }
}
