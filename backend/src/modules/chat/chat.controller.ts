import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '../../common/enums.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, Roles } from '../auth/decorators.js';
import { ChatMessageView, SendChatMessageDto } from './chat.dto.js';
import { ChatService } from './chat.service.js';

@ApiTags('Chat')
@ApiBearerAuth()
@Controller('bookings/:bookingId/messages')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  @Roles(UserRole.Customer, UserRole.Driver, UserRole.Admin)
  @ApiOperation({ summary: 'Messages of a booking, oldest first (customer, its driver, admins)' })
  @ApiOkResponse({ type: [ChatMessageView] })
  list(
    @CurrentAuth() auth: AuthContext,
    @Param('bookingId', new ParseUUIDPipe()) bookingId: string,
  ): Promise<ChatMessageView[]> {
    return this.chat.list(auth, bookingId);
  }

  @Post()
  @Roles(UserRole.Customer, UserRole.Driver)
  @ApiOperation({ summary: 'Send a message to the other side of the job' })
  @ApiOkResponse({ type: ChatMessageView })
  send(
    @CurrentAuth() auth: AuthContext,
    @Param('bookingId', new ParseUUIDPipe()) bookingId: string,
    @Body() dto: SendChatMessageDto,
  ): Promise<ChatMessageView> {
    return this.chat.send(auth, bookingId, dto);
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.Customer, UserRole.Driver, UserRole.Admin)
  @ApiOperation({ summary: "Mark the other side's messages as read" })
  read(
    @CurrentAuth() auth: AuthContext,
    @Param('bookingId', new ParseUUIDPipe()) bookingId: string,
  ): Promise<{ readAt: Date }> {
    return this.chat.markRead(auth, bookingId);
  }
}
