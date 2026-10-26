import React from 'react';
import { BOOKING_STATUS_LABELS } from '../../services/catalog';
import { TripStatus } from '../../types';

export interface StatusBadgeProps {
  status: TripStatus | 'online' | 'offline' | 'busy' | 'en_route' | 'approved' | 'pending' | 'rejected' | 'suspended';
  className?: string;
}

// Same tones and pill shape as the Flutter StatusChip (mobile/townow_core/lib/src/ui/design.dart).
const TONES = {
  info: 'bg-[#e8f0fe] text-info',
  success: 'bg-[#e3f5ec] text-success',
  warning: 'bg-[#fdf3e1] text-warning',
  danger: 'bg-[#fbe9e9] text-danger',
  lime: 'bg-lime text-navy',
  neutral: 'bg-canvas text-muted',
} as const;

const OTHER_LABELS: Record<string, string> = {
  approved: 'KYC Approved',
  rejected: 'KYC Rejected',
  suspended: 'Suspended',
  pending: 'Pending KYC',
  online: 'Online',
  offline: 'Offline',
  busy: 'On Job',
  en_route: 'En Route',
};

function toneOf(status: string): keyof typeof TONES {
  switch (status) {
    case 'requested':
    case 'searching':
      return 'info';
    case 'driver_assigned':
    case 'driver_arriving':
    case 'driver_arrived':
    case 'vehicle_loaded':
    case 'in_transit':
    case 'busy':
    case 'en_route':
      return 'lime';
    case 'completed':
    case 'approved':
    case 'online':
      return 'success';
    case 'cancelled':
    case 'rejected':
    case 'suspended':
      return 'danger';
    case 'pending':
      return 'warning';
    default:
      return 'neutral';
  }
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className = '' }) => (
  <span
    className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-extrabold ${TONES[toneOf(status)]} ${className}`}
  >
    {BOOKING_STATUS_LABELS[status] ?? OTHER_LABELS[status] ?? String(status).replace(/_/g, ' ')}
  </span>
);
