import { BookingStatus, DisputeStatus, KycStatus } from '../../common/enums.js';
import { RealtimeEvent } from '../../infrastructure/realtime/realtime.emitter.js';

export interface NotificationMessage {
  /** Machine-readable kind stored on the notification, e.g. "booking.driver_arrived". */
  type: string;
  title: string;
  body: string;
  /** Deep-link data; FCM requires string values. */
  data: Record<string, string>;
}

const BOOKING_TEXT: Partial<Record<BookingStatus, [string, string]>> = {
  [BookingStatus.DriverAssigned]: ['Driver found', 'A tow truck has accepted your request.'],
  [BookingStatus.DriverArriving]: ['Driver on the way', 'Your tow truck is heading to you.'],
  [BookingStatus.DriverArrived]: ['Driver has arrived', 'Your tow truck is at the pickup point.'],
  [BookingStatus.InTransit]: [
    'Vehicle on its way',
    'Your vehicle is being towed to the destination.',
  ],
  [BookingStatus.Completed]: [
    'Tow completed',
    'Your vehicle was delivered. Thank you for using TowNow.',
  ],
  [BookingStatus.Cancelled]: ['Booking cancelled', 'Your tow request was cancelled.'],
};

type Payload = Record<string, unknown> | null | undefined;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Which realtime events also become an inbox entry + push (for when the app is in the
 * background). Live location and offer withdrawals are socket-only.
 */
export function messageFor(event: string, raw: unknown): NotificationMessage | null {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Payload & Record<string, unknown>;
  switch (event) {
    case RealtimeEvent.OfferNew: {
      const pickup = (p.pickup ?? {}) as Record<string, unknown>;
      return {
        type: 'offer.new',
        title: 'New tow request',
        body: `Pickup: ${str(pickup.address) || 'nearby'}. Open TowNow to accept before it expires.`,
        data: { offerId: str(p.offerId), bookingId: str(p.bookingId) },
      };
    }
    case RealtimeEvent.JobCancelled:
      return {
        type: 'job.cancelled',
        title: 'Job cancelled',
        body: 'The tow job you were assigned to was cancelled.',
        data: { bookingId: str(p.bookingId) },
      };
    case RealtimeEvent.BookingUpdated: {
      const text = BOOKING_TEXT[p.status as BookingStatus];
      if (!text) return null;
      return {
        type: `booking.${str(p.status)}`,
        title: text[0],
        body: text[1],
        data: { bookingId: str(p.bookingId), status: str(p.status) },
      };
    }
    case RealtimeEvent.KycUpdated: {
      const approved = p.kycStatus === KycStatus.Approved;
      if (!approved && p.kycStatus !== KycStatus.Rejected) return null;
      return {
        type: `kyc.${str(p.kycStatus)}`,
        title: approved ? 'You are approved' : 'Verification needs attention',
        body: approved
          ? 'Your documents were approved. You can go online and receive tow requests.'
          : str(p.reason) || 'Some documents were rejected. Please check and re-upload them.',
        data: {},
      };
    }
    case RealtimeEvent.DisputeUpdated:
      return {
        type: `dispute.${str(p.status)}`,
        title: p.status === DisputeStatus.Resolved ? 'Dispute resolved' : 'Dispute closed',
        body: `TowNow support has decided your dispute about ${str(p.bookingNumber) || 'your tow'}.`,
        data: { disputeId: str(p.disputeId), bookingId: str(p.bookingId) },
      };
    case RealtimeEvent.DriverLocationStale:
      return p.setOffline
        ? {
            type: 'driver.set_offline',
            title: 'You are offline',
            body: 'Your location stopped updating, so TowNow set you offline. Open the app to go online again.',
            data: {},
          }
        : {
            type: 'driver.location_stale',
            title: 'Your location is not updating',
            body: 'You will not get tow requests until it does. Open TowNow and keep it allowed to run in the background.',
            data: {},
          };
    default:
      return null;
  }
}
