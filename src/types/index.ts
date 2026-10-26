/**
 * TowNow Type Definitions
 * Complete domain models for UAE On-Demand Towing Platform
 */

export type VehicleCategory = 'car' | 'motorbike';

export type TowType = 'flatbed' | 'wheel-lift' | 'bike-carrier';

export type VehicleIssue =
  | 'Breakdown'
  | 'Flat Tyre'
  | 'Accident'
  | 'Battery Issue'
  | 'Engine Issue'
  | 'Overheating'
  | 'Locked Out'
  | 'Other';

export type TripStatus =
  | 'requested'
  | 'searching'
  | 'driver_assigned'
  | 'driver_arriving'
  | 'driver_arrived'
  | 'vehicle_loaded'
  | 'in_transit'
  | 'completed'
  | 'cancelled';

export type PaymentMethod = 'cash' | 'card' | 'apple_pay';

/** The seven emirates (plate issuing authorities). */
export type Emirate =
  | 'Dubai'
  | 'Abu Dhabi'
  | 'Sharjah'
  | 'Ajman'
  | 'Umm Al Quwain'
  | 'Ras Al Khaimah'
  | 'Fujairah';

export interface LocationItem {
  id: string;
  name: string;
  address: string;
  city: 'Dubai' | 'Abu Dhabi' | 'Sharjah';
  coordinates: { x: number; y: number }; // Percentage coords on visual map [0-100]
  /** Real WGS84 position; required for anything sent to the API. */
  lat?: number;
  lng?: number;
  type?: 'home' | 'work' | 'recent' | 'current';
}

export interface CustomerVehicle {
  id: string;
  brand: string;
  model: string;
  year: number;
  color: string;
  plateNumber: string;
  plateCode: string; // e.g. "Dubai A" or "Abu Dhabi 4"
  plateEmirate: Emirate;
  category: VehicleCategory;
  isDefault?: boolean;
}

export interface DriverPartner {
  id: string;
  name: string;
  avatar: string;
  phone: string;
  rating: number;
  totalTrips: number;
  experienceYears: number;
  kycStatus: 'pending' | 'approved' | 'rejected' | 'suspended';
  status: 'online' | 'offline' | 'busy' | 'en_route';
  vehicle: {
    type: TowType;
    plateNumber: string;
    model: string;
    year: number;
  };
  currentLocation: {
    name: string;
    coordinates: { x: number; y: number };
    /** Real WGS84 position (live GPS fix); the map draws the truck only when set. */
    lat?: number;
    lng?: number;
  };
  earningsToday: number;
  earningsWeek: number;
  completedJobsToday: number;
  acceptanceRate: number;
}

export interface Booking {
  id: string;
  bookingNumber: string;
  createdAt: string;
  status: TripStatus;
  customer: {
    id: string;
    name: string;
    phone: string;
    avatar?: string;
  };
  vehicle: CustomerVehicle;
  issue: VehicleIssue;
  towType: TowType;
  pickup: LocationItem;
  destination: LocationItem;
  driver?: DriverPartner;
  notes?: string;
  fareBreakdown: {
    baseFare: number;
    distanceCharge: number;
    towTypeCharge: number;
    additionalCharges: number;
    subtotal: number;
    vat: number; // 5%
    total: number;
  };
  paymentMethod: PaymentMethod;
  paymentStatus: 'paid' | 'pending' | 'cash_collected';
  etaMinutes: number;
  distanceKm: number;
  rating?: {
    stars: number;
    tags: string[];
    comment?: string;
  };
}

export interface PricingConfig {
  baseFareCar: number;
  baseFareBike: number;
  perKmRate: number;
  minimumFare: number;
  flatbedMultiplier: number;
  wheelLiftMultiplier: number;
  bikeCarrierMultiplier: number;
  nightSurcharge: number;
  vatRatePercent: number; // 5%
  platformCommissionPercent: number; // 20%
}

export interface ServiceZone {
  id: string;
  name: string;
  emirate: 'Dubai' | 'Abu Dhabi';
  activeDrivers: number;
  status: 'active' | 'peak' | 'restricted';
  avgEtaMinutes: number;
  surgeMultiplier: number;
}

export interface SupportTicket {
  id: string;
  ticketId: string;
  createdAt: string;
  requesterType: 'customer' | 'driver';
  requesterName: string;
  requesterPhone: string;
  subject: string;
  category: 'Billing' | 'Driver Conduct' | 'Delay' | 'Damage Claim' | 'App Issue';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  bookingId?: string;
  lastMessage: string;
}

export interface AuditLogItem {
  id: string;
  timestamp: string;
  userName: string;
  role: string;
  action: string;
  module: string;
  ipAddress: string;
  description: string;
}
