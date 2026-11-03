import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Trim } from '../../common/validation/string.decorators.js';

export class SendChatMessageDto {
  @ApiProperty({ maxLength: 1000 })
  @Trim()
  @IsString()
  @Length(1, 1000)
  body!: string;

  @ApiPropertyOptional({
    description: 'App-generated UUID; a retry with the same id is stored once',
  })
  @IsOptional()
  @IsUUID()
  clientId?: string;
}

export class ChatMessageView {
  @ApiProperty() id!: string;
  @ApiProperty() bookingId!: string;
  @ApiProperty({ nullable: true, type: String }) clientId!: string | null;
  @ApiProperty({ enum: ['customer', 'driver'] }) senderRole!: 'customer' | 'driver';
  @ApiProperty({ description: 'Sent by the caller' }) mine!: boolean;
  @ApiProperty() body!: string;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ nullable: true, type: Date, description: 'When the recipient read it' })
  readAt!: Date | null;
}
