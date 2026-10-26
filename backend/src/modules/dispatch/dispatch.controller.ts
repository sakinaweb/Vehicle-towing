import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Put,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { InspectionStage, UserRole } from '../../common/enums.js';
import { privateFile } from '../../infrastructure/storage/private-file.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, Roles } from '../auth/decorators.js';
import {
  AvailabilityView,
  CurrentJobView,
  CurrentOfferView,
  DriverJobView,
  LocationAcceptedView,
  LocationUpdateDto,
  SetAvailabilityDto,
} from './dispatch.dto.js';
import { DriverAvailabilityService } from './driver-availability.service.js';
import { DriverLocationService } from './driver-location.service.js';
import {
  InspectionDetailsDto,
  InspectionListView,
  InspectionView,
  PHOTO_UPLOAD_SCHEMA,
  PhotoUploadDto,
} from './inspection.dto.js';
import { InspectionsService, UploadedPhoto } from './inspections.service.js';
import { MatchingService } from './matching.service.js';
import { MAX_PHOTO_BYTES } from './trip.rules.js';

/** Everything here acts on the signed-in driver only — no driver id is ever taken from the client. */
@ApiTags('Dispatch (driver)')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Caller is not a driver' })
@Roles(UserRole.Driver)
@Controller('drivers/me')
export class DispatchController {
  constructor(
    private readonly availability: DriverAvailabilityService,
    private readonly locations: DriverLocationService,
    private readonly matching: MatchingService,
    private readonly inspectionsService: InspectionsService,
  ) {}

  @Get('availability')
  @ApiOperation({ summary: 'My availability and when my location was last updated' })
  @ApiOkResponse({ type: AvailabilityView })
  getAvailability(@CurrentAuth() auth: AuthContext): Promise<AvailabilityView> {
    return this.availability.get(auth.userId);
  }

  @Put('availability')
  @ApiOperation({ summary: 'Go online or offline' })
  @ApiOkResponse({ type: AvailabilityView })
  @ApiConflictResponse({ description: 'KYC pending, no active truck, or a job in progress' })
  setAvailability(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: SetAvailabilityDto,
  ): Promise<AvailabilityView> {
    return this.availability.set(auth.userId, dto);
  }

  @Post('location')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Report my current position (REST fallback for the socket event)' })
  @ApiOkResponse({ type: LocationAcceptedView })
  @ApiConflictResponse({ description: 'Offline, or a newer location is already recorded' })
  updateLocation(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: LocationUpdateDto,
  ): Promise<LocationAcceptedView> {
    return this.locations.update(auth.userId, dto);
  }

  @Get('offers/current')
  @ApiOperation({ summary: 'The job offer currently waiting for my answer (null if none)' })
  @ApiOkResponse({ type: CurrentOfferView })
  async currentOffer(@CurrentAuth() auth: AuthContext): Promise<CurrentOfferView> {
    return { offer: await this.matching.currentOffer(auth.userId) };
  }

  @Post('offers/:id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept a job offer (idempotent)' })
  @ApiOkResponse({ type: DriverJobView })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Offer expired, withdrawn or taken' })
  accept(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DriverJobView> {
    return this.matching.accept(auth.userId, id);
  }

  @Post('offers/:id/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Decline a job offer' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  decline(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.matching.decline(auth.userId, id);
  }

  @Get('jobs/current')
  @ApiOperation({ summary: 'My assigned job in progress (null if none)' })
  @ApiOkResponse({ type: CurrentJobView })
  async currentJob(@CurrentAuth() auth: AuthContext): Promise<CurrentJobView> {
    return { job: await this.matching.currentJob(auth.userId) };
  }

  @Post('jobs/:bookingId/en-route')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start driving to the pickup (customer sees "Driver en route")' })
  @ApiOkResponse({ type: DriverJobView })
  @ApiConflictResponse({ description: 'Not the next step for this job' })
  enRoute(@CurrentAuth() auth: AuthContext, @Param('bookingId', new ParseUUIDPipe()) id: string) {
    return this.matching.advanceTrip(auth.userId, id, 'en-route');
  }

  @Post('jobs/:bookingId/arrived')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'I am at the pickup' })
  @ApiOkResponse({ type: DriverJobView })
  @ApiConflictResponse({ description: 'Not the next step for this job' })
  arrived(@CurrentAuth() auth: AuthContext, @Param('bookingId', new ParseUUIDPipe()) id: string) {
    return this.matching.advanceTrip(auth.userId, id, 'arrived');
  }

  @Post('jobs/:bookingId/start-tow')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Vehicle loaded, start the tow (needs the submitted pickup inspection)',
  })
  @ApiOkResponse({ type: DriverJobView })
  @ApiConflictResponse({ description: 'Pickup inspection missing, or not the next step' })
  startTow(@CurrentAuth() auth: AuthContext, @Param('bookingId', new ParseUUIDPipe()) id: string) {
    return this.matching.advanceTrip(auth.userId, id, 'start-tow');
  }

  @Post('jobs/:bookingId/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vehicle delivered (needs the submitted return inspection)' })
  @ApiOkResponse({ type: DriverJobView })
  @ApiConflictResponse({ description: 'Return inspection missing, or not the next step' })
  complete(@CurrentAuth() auth: AuthContext, @Param('bookingId', new ParseUUIDPipe()) id: string) {
    return this.matching.advanceTrip(auth.userId, id, 'complete');
  }

  // ---------------------------------------------------------------- inspections

  @Get('jobs/:bookingId/inspections')
  @ApiOperation({ summary: 'Pickup and return inspections of my job' })
  @ApiOkResponse({ type: InspectionListView })
  async inspections(
    @CurrentAuth() auth: AuthContext,
    @Param('bookingId', new ParseUUIDPipe()) id: string,
  ): Promise<InspectionListView> {
    return { inspections: await this.inspectionsService.list(auth, id) };
  }

  @Put('jobs/:bookingId/inspections/:stage')
  @ApiOperation({ summary: 'Save odometer, fuel level and checklist (draft until submitted)' })
  @ApiOkResponse({ type: InspectionView })
  @ApiConflictResponse({ description: 'Wrong trip stage, or already submitted' })
  saveInspection(
    @CurrentAuth() auth: AuthContext,
    @Param('bookingId', new ParseUUIDPipe()) id: string,
    @Param('stage', new ParseEnumPipe(InspectionStage)) stage: InspectionStage,
    @Body() dto: InspectionDetailsDto,
  ): Promise<InspectionView> {
    return this.inspectionsService.saveDetails(auth.userId, id, stage, dto);
  }

  @Post('jobs/:bookingId/inspections/:stage/photos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: PHOTO_UPLOAD_SCHEMA })
  @ApiOperation({ summary: 'Add a photo (front/back/left/right replace; up to 6 extras)' })
  @ApiCreatedResponse({ type: InspectionView })
  @ApiBadRequestResponse({ description: 'Missing file, not an image, or over 8 MB' })
  addPhoto(
    @CurrentAuth() auth: AuthContext,
    @Param('bookingId', new ParseUUIDPipe()) id: string,
    @Param('stage', new ParseEnumPipe(InspectionStage)) stage: InspectionStage,
    @Body() dto: PhotoUploadDto,
    @UploadedFile() file: UploadedPhoto | undefined,
  ): Promise<InspectionView> {
    return this.inspectionsService.addPhoto(auth.userId, id, stage, dto.slot, file);
  }

  @Delete('jobs/:bookingId/inspections/:stage/photos/:photoId')
  @ApiOperation({ summary: 'Remove a photo from a draft inspection' })
  @ApiOkResponse({ type: InspectionView })
  deletePhoto(
    @CurrentAuth() auth: AuthContext,
    @Param('bookingId', new ParseUUIDPipe()) id: string,
    @Param('stage', new ParseEnumPipe(InspectionStage)) stage: InspectionStage,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
  ): Promise<InspectionView> {
    return this.inspectionsService.deletePhoto(auth.userId, id, stage, photoId);
  }

  @Post('jobs/:bookingId/inspections/:stage/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit and lock the inspection (needs the 4 required photos; idempotent)',
  })
  @ApiOkResponse({ type: InspectionView })
  @ApiConflictResponse({ description: 'Photos missing or wrong trip stage' })
  submitInspection(
    @CurrentAuth() auth: AuthContext,
    @Param('bookingId', new ParseUUIDPipe()) id: string,
    @Param('stage', new ParseEnumPipe(InspectionStage)) stage: InspectionStage,
  ): Promise<InspectionView> {
    return this.inspectionsService.submit(auth.userId, id, stage);
  }

  @Get('jobs/:bookingId/inspections/photos/:photoId')
  @ApiOperation({ summary: 'Download an inspection photo of my job' })
  @ApiProduces('image/*')
  async photo(
    @CurrentAuth() auth: AuthContext,
    @Param('bookingId', new ParseUUIDPipe()) id: string,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
  ): Promise<StreamableFile> {
    return privateFile(await this.inspectionsService.photo(auth, id, photoId));
  }
}
