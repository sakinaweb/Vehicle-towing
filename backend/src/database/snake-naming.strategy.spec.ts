import { SnakeNamingStrategy } from './snake-naming.strategy.js';

describe('SnakeNamingStrategy', () => {
  const s = new SnakeNamingStrategy();

  it.each([
    ['createdAt', 'created_at'],
    ['customerVehicleId', 'customer_vehicle_id'],
    ['baseFareFils', 'base_fare_fils'],
    ['vatRateBps', 'vat_rate_bps'],
    ['phone', 'phone'],
  ])('maps column %s → %s', (prop, column) => {
    expect(s.columnName(prop, undefined, [])).toBe(column);
  });

  it('respects an explicit column name', () => {
    expect(s.columnName('ignored', 'custom_name', [])).toBe('custom_name');
  });

  it('builds foreign key column names from the relation', () => {
    expect(s.joinColumnName('customerVehicle', 'id')).toBe('customer_vehicle_id');
  });

  it('snake-cases class names for tables unless named explicitly', () => {
    expect(s.tableName('BookingStatusHistory', undefined)).toBe('booking_status_history');
    expect(s.tableName('Booking', 'bookings')).toBe('bookings');
  });
});
