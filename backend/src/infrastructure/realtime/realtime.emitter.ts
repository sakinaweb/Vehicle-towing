import { Global, Injectable, Logger, Module } from '@nestjs/common';
/** A Socket.IO namespace (API process) or a Redis emitter for it (worker process). */
export interface RoomBroadcaster {
  to(room: string): { emit(event: string, ...args: unknown[]): unknown };
}

/** Redis channel prefix shared by the Socket.IO adapter (API) and emitter (worker). */
export const socketIoKey = (queuePrefix: string) => `${queuePrefix}:socket.io`;

/** Event names sent to clients. Payloads never contain phone numbers or emails. */
export const RealtimeEvent = {
  /** → driver: a new job offer (accept before expiresAt). */
  OfferNew: 'offer:new',
  /** → driver: the offer is gone (expired / taken back / booking cancelled). */
  OfferClosed: 'offer:closed',
  /** → driver: the assigned job was cancelled by the customer. */
  JobCancelled: 'job:cancelled',
  /** → customer: booking status changed (searching → driver_assigned → driver_arriving …). */
  BookingUpdated: 'booking:updated',
  /** Driver: their KYC review result. */
  KycUpdated: 'kyc:updated',
  /** Customer: live position of the driver working their booking. */
  TripLocation: 'trip:location',
  /** Customer: their booking's payment changed (authorised, failed, captured…). */
  PaymentUpdated: 'payment:updated',
  /** Customer/driver: operations decided a dispute they raised. */
  DisputeUpdated: 'dispute:updated',
  /** Driver: their GPS stopped updating while online ({ setOffline } when they were set offline). */
  DriverLocationStale: 'driver:location_stale',
} as const;

export const userRoom = (userId: string) => `user:${userId}`;

/**
 * Lets domain code push events without depending on the gateway (avoids module
 * cycles). The gateway hands over its namespace on init. If it isn't available,
 * events are dropped and clients still get the state from the REST endpoints.
 */
@Injectable()
export class RealtimeEmitter {
  private readonly logger = new Logger(RealtimeEmitter.name);
  private namespace: RoomBroadcaster | null = null;
  private readonly listeners: ((userId: string, event: string, payload: unknown) => void)[] = [];

  attach(namespace: RoomBroadcaster): void {
    this.namespace = namespace;
  }

  /** Lets the notifications module mirror selected events to the inbox and push. */
  onEmit(listener: (userId: string, event: string, payload: unknown) => void): void {
    this.listeners.push(listener);
  }

  toUser(userId: string, event: string, payload: unknown): void {
    for (const listener of this.listeners) listener(userId, event, payload);
    if (!this.namespace) {
      this.logger.debug(`Realtime not ready; dropped ${event} for ${userId}`);
      return;
    }
    this.namespace.to(userRoom(userId)).emit(event, payload);
  }
}

@Global()
@Module({ providers: [RealtimeEmitter], exports: [RealtimeEmitter] })
export class RealtimeEmitterModule {}
