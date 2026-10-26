import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatMessage } from './entities/chat-message.entity.js';

/** Booking-scoped customer/driver messaging. */
@Module({
  imports: [TypeOrmModule.forFeature([ChatMessage])],
  exports: [TypeOrmModule],
})
export class ChatModule {}
