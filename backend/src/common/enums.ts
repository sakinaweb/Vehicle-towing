/**
 * Shared domain enums. Values match the frontend types in src/types/index.ts
 * so the UI can consume API responses without mapping.
 */

export enum UserRole {
  Customer = 'customer',
  Driver = 'driver',
  Admin = 'admin',
  Staff = 'staff',
}

export enum UserStatus {
  Active = 'active',
  Suspended = 'suspended',
  Deleted = 'deleted',
}

export enum Emirate {
  Dubai = 'Dubai',
  AbuDhabi = 'Abu Dhabi',
  Sharjah = 'Sharjah',
  Ajman = 'Ajman',
  UmmAlQuwain = 'Umm Al Quwain',
  RasAlKhaimah = 'Ras Al Khaimah',
  Fujairah = 'Fujairah',
}

export enum VehicleCategory {
  Car = 'car',
  Motorbike = 'motorbike',
}

export enum TowType {
  Flatbed = 'flatbed',
  WheelLift = 'wheel-lift',
  BikeCarrier = 'bike-carrier',
}

export enum VehicleIssue {
  Breakdown = 'Breakdown',
  FlatTyre = 'Flat Tyre',
  Accident = 'Accident',
  BatteryIssue = 'Battery Issue',
  EngineIssue = 'Engine Issue',
  Overheating = 'Overheating',
  LockedOut = 'Locked Out',
  Other = 'Other',
}

/** Tow job lifecycle. The first two states precede the frontend's TripStatus. */
export enum BookingStatus {
  Requested = 'requested',
  Searching = 'searching',
  DriverAssigned = 'driver_assigned',
  DriverArriving = 'driver_arriving',
  DriverArrived = 'driver_arrived',
  VehicleLoaded = 'vehicle_loaded',
  InTransit = 'in_transit',
  Completed = 'completed',
  Cancelled = 'cancelled',
}

export enum PaymentMethod {
  Cash = 'cash',
  Card = 'card',
  ApplePay = 'apple_pay',
}

export enum PaymentStatus {
  Pending = 'pending',
  Authorized = 'authorized',
  Captured = 'captured',
  Failed = 'failed',
  Refunded = 'refunded',
  Cancelled = 'cancelled',
}

export enum KycStatus {
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected',
  Suspended = 'suspended',
}

export enum DriverAvailability {
  Offline = 'offline',
  Online = 'online',
  Busy = 'busy',
  EnRoute = 'en_route',
}

export enum DriverDocumentType {
  EmiratesId = 'emirates_id',
  DrivingLicence = 'driving_licence',
  VehicleRegistration = 'vehicle_registration',
  CommercialInsurance = 'commercial_insurance',
}

export enum DocumentStatus {
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected',
  Expired = 'expired',
}

export enum ZoneStatus {
  Active = 'active',
  Peak = 'peak',
  Restricted = 'restricted',
}

export enum SavedLocationType {
  Home = 'home',
  Work = 'work',
  Garage = 'garage',
  Other = 'other',
}

export enum NotificationChannel {
  InApp = 'in_app',
  Push = 'push',
  Sms = 'sms',
  Email = 'email',
}

export enum CancelledBy {
  Customer = 'customer',
  Driver = 'driver',
  Admin = 'admin',
  System = 'system',
}

/** Lifecycle of one job offer to one driver. */
export enum OfferStatus {
  Pending = 'pending',
  Accepted = 'accepted',
  Declined = 'declined',
  Expired = 'expired',
  /** Withdrawn: booking cancelled, or the driver went offline before answering. */
  Cancelled = 'cancelled',
}

/** When a vehicle inspection is taken: on collection, and on hand-over at the destination. */
export enum InspectionStage {
  Pickup = 'pickup',
  Return = 'return',
}

export enum FuelLevel {
  Empty = 'empty',
  Quarter = 'quarter',
  Half = 'half',
  ThreeQuarters = 'three_quarters',
  Full = 'full',
}

/** The four required angles, plus optional extra close-ups (damage, dashboard). */
export enum PhotoSlot {
  Front = 'front',
  Back = 'back',
  Left = 'left',
  Right = 'right',
  Extra = 'extra',
}

/** Driver ledger lines. Positive = TowNow owes the driver; negative = the driver owes TowNow. */
export enum LedgerEntryType {
  /** Driver's share of a completed trip: fare excl. VAT minus the platform commission. */
  TripEarning = 'trip_earning',
  /** Cash the driver collected from the customer on TowNow's behalf (negative). */
  CashCollected = 'cash_collected',
  /** Driver paid TowNow what they owed (commission/VAT on cash trips) — positive. */
  Remittance = 'remittance',
  /** TowNow paid the driver their earnings (card trips) — negative. */
  Payout = 'payout',
}

export enum DisputeStatus {
  Open = 'open',
  Resolved = 'resolved',
  Rejected = 'rejected',
}

export enum DevicePlatform {
  Android = 'android',
  Ios = 'ios',
  Web = 'web',
}
