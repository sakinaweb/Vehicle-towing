import { DriverAvailability } from '../../common/enums.js';
import {
  availabilityChangeError,
  locationTimestampError,
  staleLocationAction,
} from './dispatch.rules.js';

const OK = { kycApproved: true, hasActiveTruck: true };

describe('availabilityChangeError', () => {
  it('lets an approved driver with a truck go online and offline', () => {
    expect(
      availabilityChangeError(DriverAvailability.Offline, DriverAvailability.Online, OK),
    ).toBeNull();
    expect(
      availabilityChangeError(DriverAvailability.Online, DriverAvailability.Offline, OK),
    ).toBeNull();
    expect(
      availabilityChangeError(DriverAvailability.Online, DriverAvailability.Online, OK),
    ).toBeNull();
  });

  it('requires KYC approval and an active truck to go online', () => {
    expect(
      availabilityChangeError(DriverAvailability.Offline, DriverAvailability.Online, {
        ...OK,
        kycApproved: false,
      }),
    ).toMatch(/pending verification/);
    expect(
      availabilityChangeError(DriverAvailability.Offline, DriverAvailability.Online, {
        ...OK,
        hasActiveTruck: false,
      }),
    ).toMatch(/active tow truck/);
  });

  it('still allows an unapproved driver to go offline', () => {
    expect(
      availabilityChangeError(DriverAvailability.Online, DriverAvailability.Offline, {
        kycApproved: false,
        hasActiveTruck: false,
      }),
    ).toBeNull();
  });

  it.each([DriverAvailability.Busy, DriverAvailability.EnRoute])(
    'blocks manual changes while %s',
    (current) => {
      for (const target of [DriverAvailability.Online, DriverAvailability.Offline] as const) {
        expect(availabilityChangeError(current, target, OK)).toMatch(/job in progress/);
      }
    },
  );
});

describe('locationTimestampError', () => {
  const now = new Date('2026-10-08T10:00:00Z');
  const ago = (s: number) => new Date(now.getTime() - s * 1000);

  it('accepts a fresh timestamp', () => {
    expect(locationTimestampError(ago(5), now, ago(10), 120)).toBeNull();
    expect(locationTimestampError(now, now, null, 120)).toBeNull();
  });

  it('tolerates small clock skew but rejects the future', () => {
    expect(locationTimestampError(ago(-20), now, null, 120)).toBeNull();
    expect(locationTimestampError(ago(-60), now, null, 120)).toMatch(/future/);
  });

  it('rejects stale and out-of-order locations', () => {
    expect(locationTimestampError(ago(121), now, null, 120)).toMatch(/older than 120 seconds/);
    expect(locationTimestampError(ago(10), now, ago(5), 120)).toMatch(/newer location/);
    expect(locationTimestampError(ago(5), now, ago(5), 120)).toMatch(/newer location/);
  });

  it('rejects invalid dates', () => {
    expect(locationTimestampError(new Date('nope'), now, null, 120)).toMatch(/not a valid/);
  });
});

describe('staleLocationAction', () => {
  it('does nothing while the location is fresh enough for matching', () => {
    expect(staleLocationAction(120, 120, 600)).toBeNull();
  });

  it('warns once too old for matching, then sets offline', () => {
    expect(staleLocationAction(121, 120, 600)).toBe('warn');
    expect(staleLocationAction(600, 120, 600)).toBe('offline');
  });

  it('never sets offline when disabled', () => {
    expect(staleLocationAction(86_400, 120, 0)).toBe('warn');
  });
});
