import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth } from '../auth/decorators.js';
import {
  InboxQuery,
  InboxView,
  NotificationsService,
  RegisterDeviceDto,
  RemoveDeviceDto,
} from './notifications.service.js';

/** Any signed-in user (customer, driver, admin): own devices and inbox only. */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('me')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Put('devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Register this app install for push (call after sign-in and on token refresh)',
  })
  @ApiNoContentResponse()
  register(@CurrentAuth() auth: AuthContext, @Body() dto: RegisterDeviceDto): Promise<void> {
    return this.notifications.registerDevice(auth.userId, dto);
  }

  @Delete('devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Stop push to this install (call before sign-out)' })
  @ApiNoContentResponse()
  remove(@CurrentAuth() auth: AuthContext, @Body() dto: RemoveDeviceDto): Promise<void> {
    return this.notifications.removeDevice(auth.userId, dto.token);
  }

  @Get('notifications')
  @ApiOperation({ summary: 'My notifications, newest first' })
  @ApiOkResponse({ type: InboxView })
  inbox(@CurrentAuth() auth: AuthContext, @Query() q: InboxQuery): Promise<InboxView> {
    return this.notifications.inbox(auth.userId, q);
  }

  @Post('notifications/read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  readAll(@CurrentAuth() auth: AuthContext): Promise<void> {
    return this.notifications.markRead(auth.userId, 'all');
  }

  @Post('notifications/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  read(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.notifications.markRead(auth.userId, [id]);
  }
}
