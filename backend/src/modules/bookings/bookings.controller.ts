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
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { UserRole } from '../../common/enums.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, Roles } from '../auth/decorators.js';
import {
  BookingListView,
  BookingView,
  CancelBookingDto,
  CreateBookingDto,
  ListBookingsQuery,
  QuoteRequestDto,
  QuoteView,
  RateBookingDto,
} from './booking.dto.js';
import { BookingsService } from './bookings.service.js';
import { QuotesService } from './quotes.service.js';
import { DriverLocationView, TrackingService } from './tracking.service.js';
import { InspectionListView } from '../dispatch/inspection.dto.js';
import { InspectionsService } from '../dispatch/inspections.service.js';
import { privateFile } from '../../infrastructure/storage/private-file.js';

@ApiTags('Bookings')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Caller is not a customer' })
@Roles(UserRole.Customer)
@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly quotes: QuotesService,
    private readonly bookings: BookingsService,
    private readonly tracking: TrackingService,
    private readonly inspections: InspectionsService,
  ) {}

  @Post('quotes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a server-calculated, time-limited fare quote for a tow' })
  @ApiOkResponse({ type: QuoteView })
  @ApiBadRequestResponse({ description: 'Invalid locations, incompatible tow type or trip length' })
  quote(@CurrentAuth() auth: AuthContext, @Body() dto: QuoteRequestDto): Promise<QuoteView> {
    return this.quotes.create(auth.userId, dto);
  }

  @Post()
  @ApiOperation({
    summary: 'Book a quote',
    description:
      'Idempotent per quote: re-submitting the same quoteId returns the existing booking with 200.',
  })
  @ApiCreatedResponse({ type: BookingView, description: 'Booking created' })
  @ApiOkResponse({ type: BookingView, description: 'Already booked with this quote (replay)' })
  @ApiGoneResponse({ description: 'Quote expired' })
  @ApiConflictResponse({ description: 'Vehicle already has an active tow request' })
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateBookingDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BookingView> {
    const { booking, created } = await this.bookings.create(auth.userId, dto);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    if (!created) res.setHeader('Idempotent-Replayed', 'true');
    return booking;
  }

  @Get()
  @ApiOperation({ summary: 'List my bookings, newest first' })
  @ApiOkResponse({ type: BookingListView })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListBookingsQuery,
  ): Promise<BookingListView> {
    return this.bookings.list(auth.userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of my bookings, with its status history' })
  @ApiOkResponse({ type: BookingView })
  @ApiNotFoundResponse()
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<BookingView> {
    return this.bookings.get(auth.userId, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel my booking (allowed until the truck is on scene)' })
  @ApiOkResponse({ type: BookingView })
  @ApiConflictResponse({ description: 'Already cancelled or too late to cancel' })
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelBookingDto,
  ): Promise<BookingView> {
    return this.bookings.cancel(auth.userId, id, dto.reason);
  }

  @Post(':id/rating')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rate the driver of my completed tow (once)' })
  @ApiOkResponse({ type: BookingView })
  @ApiConflictResponse({ description: 'Not completed yet, or already rated' })
  rate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RateBookingDto,
  ): Promise<BookingView> {
    return this.bookings.rate(auth.userId, id, dto.rating, dto.comment);
  }

  @Get(':id/driver-location')
  @ApiOperation({ summary: 'Live position and ETA of the driver working my booking' })
  @ApiOkResponse({ type: DriverLocationView })
  @ApiNotFoundResponse({ description: 'Not my booking' })
  @ApiConflictResponse({ description: 'No driver is on this booking right now' })
  driverLocation(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DriverLocationView> {
    return this.tracking.driverLocation(auth.userId, id);
  }

  @Get(':id/inspections')
  @ApiOperation({ summary: 'Pickup and return inspections recorded by the driver' })
  @ApiOkResponse({ type: InspectionListView })
  async listInspections(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<InspectionListView> {
    return { inspections: await this.inspections.list(auth, id) };
  }

  @Get(':id/inspections/photos/:photoId')
  @ApiOperation({ summary: 'Download an inspection photo of my booking' })
  @ApiProduces('image/*')
  async inspectionPhoto(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
  ): Promise<StreamableFile> {
    return privateFile(await this.inspections.photo(auth, id, photoId));
  }
}
