import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '../../common/enums.js';
import { privateFile } from '../../infrastructure/storage/private-file.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, Roles } from '../auth/decorators.js';
import {
  AdminKycService,
  KycDriverView,
  KycQueueQuery,
  KycQueueView,
  RejectKycDto,
} from './admin-kyc.service.js';

/** Driver KYC review. Admin role only (enforced by the global RolesGuard). */
@ApiTags('Admin · KYC')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Caller is not an admin' })
@Roles(UserRole.Admin)
@Controller('admin/drivers')
export class AdminController {
  constructor(private readonly kyc: AdminKycService) {}

  @Get()
  @ApiOperation({ summary: 'Drivers by KYC status (default: pending), oldest first' })
  @ApiOkResponse({ type: KycQueueView })
  queue(@Query() q: KycQueueQuery): Promise<KycQueueView> {
    return this.kyc.queue(q);
  }

  @Get(':driverId')
  @ApiOperation({ summary: 'Driver details, trucks and submitted documents' })
  @ApiOkResponse({ type: KycDriverView })
  @ApiNotFoundResponse()
  detail(@Param('driverId', new ParseUUIDPipe()) driverId: string): Promise<KycDriverView> {
    return this.kyc.detail(driverId);
  }

  @Get(':driverId/documents/:documentId/file')
  @ApiOperation({ summary: 'View a submitted KYC document' })
  @ApiProduces('application/pdf', 'image/*')
  async document(
    @Param('driverId', new ParseUUIDPipe()) driverId: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
  ): Promise<StreamableFile> {
    return privateFile(await this.kyc.documentFile(driverId, documentId));
  }

  @Post(':driverId/kyc/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve KYC (needs all required documents; idempotent)' })
  @ApiOkResponse({ type: KycDriverView })
  @ApiConflictResponse({ description: 'Documents missing or driver suspended' })
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param('driverId', new ParseUUIDPipe()) driverId: string,
  ): Promise<KycDriverView> {
    return this.kyc.approve(auth.userId, driverId);
  }

  @Post(':driverId/kyc/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject KYC with a reason shown to the driver (takes them offline)' })
  @ApiOkResponse({ type: KycDriverView })
  @ApiConflictResponse({ description: 'Driver is on a job, or suspended' })
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('driverId', new ParseUUIDPipe()) driverId: string,
    @Body() dto: RejectKycDto,
  ): Promise<KycDriverView> {
    return this.kyc.reject(auth.userId, driverId, dto.reason);
  }
}
