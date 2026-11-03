import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { ChatMessage } from './entities/chat-message.entity.js';

/** Booking-scoped customer/driver messaging (REST + Socket.IO events). */
@Module({
  imports: [TypeOrmModule.forFeature([ChatMessage])],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [TypeOrmModule],
})
export class ChatModule {}
