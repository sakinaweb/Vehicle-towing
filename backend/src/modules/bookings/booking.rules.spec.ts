import { BookingStatus, TowType, VehicleCategory } from '../../common/enums.js';
import {
  cancellationFeeMayApply,
  customerCanCancel,
  formatBookingNumber,
  isActive,
  isTowTypeCompatible,
} from './booking.rules.js';

describe('booking rules', () => {
  it.each([
    [BookingStatus.Requested, true, false],
    [BookingStatus.Searching, true, false],
    [BookingStatus.DriverAssigned, true, true],
    [BookingStatus.DriverArriving, true, true],
    [BookingStatus.DriverArrived, false, false],
    [BookingStatus.VehicleLoaded, false, false],
    [BookingStatus.InTransit, false, false],
    [BookingStatus.Completed, false, false],
    [BookingStatus.Cancelled, false, false],
  ])('%s: customer can cancel=%s, fee may apply=%s', (status, cancellable, fee) => {
    expect(customerCanCancel(status)).toBe(cancellable);
    expect(cancellationFeeMayApply(status)).toBe(fee);
  });

  it('treats only completed and cancelled as final', () => {
    const active = Object.values(BookingStatus).filter(isActive);
    expect(active).not.toContain(BookingStatus.Completed);
    expect(active).not.toContain(BookingStatus.Cancelled);
    expect(active).toHaveLength(Object.values(BookingStatus).length - 2);
  });

  it.each([
    [VehicleCategory.Car, TowType.Flatbed, true],
    [VehicleCategory.Car, TowType.WheelLift, true],
    [VehicleCategory.Car, TowType.BikeCarrier, false],
    [VehicleCategory.Motorbike, TowType.BikeCarrier, true],
    [VehicleCategory.Motorbike, TowType.Flatbed, true],
    [VehicleCategory.Motorbike, TowType.WheelLift, false],
  ])('%s on %s → %s', (category, towType, ok) => {
    expect(isTowTypeCompatible(category, towType)).toBe(ok);
  });

  it('formats booking numbers', () => {
    expect(formatBookingNumber(100001)).toBe('TN-100001');
    expect(formatBookingNumber('100002')).toBe('TN-100002');
  });
});
