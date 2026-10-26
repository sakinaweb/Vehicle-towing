import React from 'react';
import { MapPin, Navigation, Calendar, ChevronRight, Truck } from 'lucide-react';
import { Booking } from '../../types';
import { StatusBadge } from '../common/StatusBadge';

export interface BookingCardProps {
  booking: Booking;
  onClick?: () => void;
}

export const BookingCard: React.FC<BookingCardProps> = ({ booking, onClick }) => {
  return (
    <div
      onClick={onClick}
      className={`p-4 sm:p-5 rounded-2xl bg-surface/80 border border-line hover:border-line transition-all ${
        onClick ? 'cursor-pointer hover:bg-surface' : ''
      }`}
    >
      {/* Top Header: Booking #, Date, Status */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-navy">
            {booking.bookingNumber}
          </span>
          <span className="text-muted">·</span>
          <span className="text-xs text-muted flex items-center gap-1">
            <Calendar className="w-3 h-3 text-muted" />
            <span>{booking.createdAt}</span>
          </span>
        </div>
        <StatusBadge status={booking.status} />
      </div>

      {/* Vehicle & Tow Type Summary */}
      <div className="flex items-center justify-between py-2 border-y border-line text-xs">
        <div className="flex items-center gap-2">
          <Truck className="w-3.5 h-3.5 text-navy" />
          <span className="font-semibold text-ink">
            {booking.vehicle.brand} {booking.vehicle.model}
          </span>
          <span className="text-muted">({booking.vehicle.plateNumber})</span>
        </div>
        <div className="text-ink/80 capitalize font-medium">
          {booking.towType}
        </div>
      </div>

      {/* Route: Pickup & Destination */}
      <div className="my-3 space-y-2 text-xs">
        <div className="flex items-start gap-2.5">
          <div className="w-2 h-2 rounded-full bg-lime mt-1 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-muted text-[10px]">PICKUP</div>
            <div className="text-ink truncate font-medium">{booking.pickup.name}</div>
          </div>
        </div>
        <div className="flex items-start gap-2.5">
          <div className="w-2 h-2 rounded-full bg-success mt-1 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-muted text-[10px]">DROP-OFF</div>
            <div className="text-ink truncate font-medium">{booking.destination.name}</div>
          </div>
        </div>
      </div>

      {/* Bottom Footer: Amount & View Details */}
      <div className="flex items-center justify-between pt-2 border-t border-line text-xs">
        <div>
          <span className="text-muted mr-1.5">Total:</span>
          <span className="font-bold text-ink tabular-nums">
            AED {booking.fareBreakdown.total.toFixed(2)}
          </span>
          <span className="text-[10px] text-muted ml-1">(incl. 5% VAT)</span>
        </div>
        <div className="flex items-center gap-1 text-navy font-medium">
          <span>Details</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </div>
      </div>
    </div>
  );
};
