import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  ParseEnumPipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { DriverDocumentType, UserRole } from '../../common/enums.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, Roles } from '../auth/decorators.js';
import {
  CreateTowTruckDto,
  DriverProfileView,
  TowTruckView,
  UpdateDriverProfileDto,
  UpdateTowTruckDto,
} from './driver.dto.js';
import {
  DOCUMENT_UPLOAD_SCHEMA,
  DriverDocumentListView,
  DriverDocumentsService,
  DriverDocumentView,
  MAX_DOCUMENT_BYTES,
  UploadDocumentDto,
} from './driver-documents.service.js';
import { DriversService } from './drivers.service.js';

@ApiTags('Drivers')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Caller is not a driver' })
@Roles(UserRole.Driver)
@Controller('drivers/me')
export class DriversController {
  constructor(
    private readonly drivers: DriversService,
    private readonly documentsService: DriverDocumentsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get my driver profile, KYC status and tow trucks' })
  @ApiOkResponse({ type: DriverProfileView })
  get(@CurrentAuth() auth: AuthContext): Promise<DriverProfileView> {
    return this.drivers.getProfile(auth.userId);
  }

  @Patch()
  @ApiOperation({ summary: 'Update my name, email or years of experience' })
  @ApiOkResponse({ type: DriverProfileView })
  update(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: UpdateDriverProfileDto,
  ): Promise<DriverProfileView> {
    return this.drivers.updateProfile(auth.userId, dto);
  }

  @Get('tow-trucks')
  @ApiOperation({ summary: 'List my tow trucks' })
  @ApiOkResponse({ type: [TowTruckView] })
  listTrucks(@CurrentAuth() auth: AuthContext): Promise<TowTruckView[]> {
    return this.drivers.listTrucks(auth.userId);
  }

  @Post('tow-trucks')
  @ApiOperation({ summary: 'Register a tow truck I operate' })
  @ApiCreatedResponse({ type: TowTruckView })
  @ApiConflictResponse({ description: 'Plate already registered, or fleet limit reached' })
  addTruck(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateTowTruckDto,
  ): Promise<TowTruckView> {
    return this.drivers.addTruck(auth.userId, dto);
  }

  @Patch('tow-trucks/:id')
  @ApiOperation({ summary: 'Update or (de)activate one of my tow trucks' })
  @ApiOkResponse({ type: TowTruckView })
  @ApiNotFoundResponse()
  updateTruck(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateTowTruckDto,
  ): Promise<TowTruckView> {
    return this.drivers.updateTruck(auth.userId, id, dto);
  }

  @Delete('tow-trucks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove one of my tow trucks (only if it has no job history)' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  removeTruck(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.drivers.removeTruck(auth.userId, id);
  }

  @Get('documents')
  @ApiOperation({ summary: 'My KYC documents and their review status' })
  @ApiOkResponse({ type: DriverDocumentListView })
  async documents(@CurrentAuth() auth: AuthContext): Promise<DriverDocumentListView> {
    return { documents: await this.documentsService.list(auth.userId) };
  }

  @Put('documents/:type')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: DOCUMENT_UPLOAD_SCHEMA })
  @ApiOperation({
    summary: 'Upload or replace a KYC document (Emirates ID, licence, Mulkiya, insurance)',
  })
  @ApiOkResponse({ type: DriverDocumentView })
  @ApiConflictResponse({ description: 'KYC already reviewed; documents are locked' })
  uploadDocument(
    @CurrentAuth() auth: AuthContext,
    @Param('type', new ParseEnumPipe(DriverDocumentType)) type: DriverDocumentType,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
  ): Promise<DriverDocumentView> {
    return this.documentsService.upload(auth.userId, type, dto, file);
  }
}
