import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull, Not } from 'typeorm';
import { BookingStatus, UserRole } from '../../common/enums.js';
import { RealtimeEmitter, RealtimeEvent } from '../../infrastructure/realtime/realtime.emitter.js';
import type { AuthContext } from '../auth/auth.types.js';
import { Booking } from '../bookings/entities/booking.entity.js';
import { Customer } from '../customers/entities/customer.entity.js';
import { Driver } from '../drivers/entities/driver.entity.js';
import { isUniqueViolation } from '../users/users.service.js';
import type { ChatMessageView, SendChatMessageDto } from './chat.dto.js';
import { ChatMessage } from './entities/chat-message.entity.js';

/** While the tow is under way the two sides can write; before and after, the chat is read-only. */
const OPEN = new Set<BookingStatus>([
  BookingStatus.DriverAssigned,
  BookingStatus.DriverArriving,
  BookingStatus.DriverArrived,
  BookingStatus.VehicleLoaded,
  BookingStatus.InTransit,
]);

interface Parties {
  booking: Booking;
  customerUserId: string;
  driverUserId: string | null;
}

/** Booking-scoped customer ↔ driver messages. Admins can read every conversation. */
@Injectable()
export class ChatService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly emitter: RealtimeEmitter,
  ) {}

  async list(viewer: AuthContext, bookingId: string): Promise<ChatMessageView[]> {
    const parties = await this.parties(viewer, bookingId);
    const rows = await this.dataSource.manager.find(ChatMessage, {
      where: { bookingId },
      order: { createdAt: 'ASC' },
      take: 500,
    });
    return rows.map((m) => this.view(m, parties, viewer.userId));
  }

  async send(
    viewer: AuthContext,
    bookingId: string,
    dto: SendChatMessageDto,
  ): Promise<ChatMessageView> {
    const parties = await this.parties(viewer, bookingId);
    if (viewer.role === UserRole.Admin) throw new NotFoundException('Booking not found.');
    if (!parties.driverUserId || !OPEN.has(parties.booking.status)) {
      throw new ConflictException('Chat is open while a driver is on the job.');
    }
    const em = this.dataSource.manager;
    let message: ChatMessage;
    try {
      message = await em.save(
        em.create(ChatMessage, {
          bookingId,
          senderId: viewer.userId,
          body: dto.body,
          clientId: dto.clientId ?? null,
          readAt: null,
        }),
      );
    } catch (err) {
      // Retried send: return the message stored the first time.
      if (!dto.clientId || !isUniqueViolation(err, 'uq_chat_messages_sender_client')) throw err;
      message = await em.findOneByOrFail(ChatMessage, {
        senderId: viewer.userId,
        clientId: dto.clientId,
      });
      return this.view(message, parties, viewer.userId);
    }
    const other =
      viewer.userId === parties.customerUserId ? parties.driverUserId : parties.customerUserId;
    this.emitter.toUser(other, RealtimeEvent.ChatMessage, this.view(message, parties, other));
    this.emitter.toUser(
      viewer.userId,
      RealtimeEvent.ChatMessage,
      this.view(message, parties, viewer.userId),
    );
    return this.view(message, parties, viewer.userId);
  }

  /** Marks the other side's messages as read and tells them. */
  async markRead(viewer: AuthContext, bookingId: string): Promise<{ readAt: Date }> {
    const parties = await this.parties(viewer, bookingId);
    const readAt = new Date();
    if (viewer.role === UserRole.Admin) return { readAt }; // reading as operations changes nothing
    const result = await this.dataSource.manager.update(
      ChatMessage,
      { bookingId, senderId: Not(viewer.userId), readAt: IsNull() },
      { readAt },
    );
    const other =
      viewer.userId === parties.customerUserId ? parties.driverUserId : parties.customerUserId;
    if (result.affected && other) {
      this.emitter.toUser(other, RealtimeEvent.ChatRead, { bookingId, readAt });
    }
    return { readAt };
  }

  private async parties(viewer: AuthContext, bookingId: string): Promise<Parties> {
    const em = this.dataSource.manager;
    const booking = await em.findOneBy(Booking, { id: bookingId });
    if (!booking) throw new NotFoundException('Booking not found.');
    const customer = await em.findOneByOrFail(Customer, { id: booking.customerId });
    const driver = booking.driverId ? await em.findOneBy(Driver, { id: booking.driverId }) : null;
    const parties = {
      booking,
      customerUserId: customer.userId,
      driverUserId: driver?.userId ?? null,
    };
    const allowed =
      viewer.role === UserRole.Admin ||
      viewer.userId === parties.customerUserId ||
      viewer.userId === parties.driverUserId;
    if (!allowed) throw new NotFoundException('Booking not found.');
    return parties;
  }

  private view(m: ChatMessage, p: Parties, viewerUserId: string | null): ChatMessageView {
    return {
      id: m.id,
      bookingId: m.bookingId,
      clientId: m.clientId,
      senderRole: m.senderId === p.customerUserId ? 'customer' : 'driver',
      mine: m.senderId === viewerUserId,
      body: m.body,
      createdAt: m.createdAt,
      readAt: m.readAt,
    };
  }
}
