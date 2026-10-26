import { calculateFare, isUaeNightTime, TariffInput } from './fare.calculator.js';

/** The seeded TowNow tariffs (see migration SeedPricingRules). */
const FLATBED: TariffInput = {
  baseFareFils: 15_000,
  perKmFils: 480,
  minimumFareFils: 15_000,
  towTypeSurchargeFils: 5_000,
  nightSurchargeFils: 3_500,
  vatRateBps: 500,
  currency: 'AED',
};
const WHEEL_LIFT: TariffInput = { ...FLATBED, baseFareFils: 12_000, towTypeSurchargeFils: 0 };

// 10:00 in Dubai = 06:00 UTC; 02:00 in Dubai = 22:00 UTC the day before.
const DAY = new Date('2026-10-08T06:00:00Z');
const NIGHT = new Date('2026-10-07T22:00:00Z');

describe('calculateFare', () => {
  it('prices the reference trip exactly (Downtown → Al Quoz, 14.2 km flatbed = AED 281.57)', () => {
    expect(calculateFare(FLATBED, 14_200, DAY)).toEqual({
      baseFareFils: 15_000,
      distanceChargeFils: 6_816, // 14.2 km × AED 4.80
      towTypeSurchargeFils: 5_000,
      nightSurchargeFils: 0,
      minimumFareAdjustmentFils: 0,
      subtotalFils: 26_816,
      vatRateBps: 500,
      vatFils: 1_341, // 1,340.8 rounded half-up
      totalFils: 28_157,
      currency: 'AED',
    });
  });

  it('prices wheel-lift without the flatbed surcharge (AED 197.57)', () => {
    const fare = calculateFare(WHEEL_LIFT, 14_200, DAY);
    expect(fare.towTypeSurchargeFils).toBe(0);
    expect(fare.totalFils).toBe(19_757);
  });

  it('adds the night surcharge between 00:00 and 05:59 UAE time', () => {
    const fare = calculateFare(FLATBED, 14_200, NIGHT);
    expect(fare.nightSurchargeFils).toBe(3_500);
    expect(fare.subtotalFils).toBe(30_316);
    expect(fare.vatFils).toBe(1_516); // 1,515.8
    expect(fare.totalFils).toBe(31_832);
  });

  it('tops up short trips to the minimum fare before VAT', () => {
    const tariff = { ...WHEEL_LIFT, minimumFareFils: 20_000 };
    const fare = calculateFare(tariff, 1_000, DAY); // 120 + 4.80 = 124.80
    expect(fare.minimumFareAdjustmentFils).toBe(20_000 - 12_480);
    expect(fare.subtotalFils).toBe(20_000);
    expect(fare.vatFils).toBe(1_000);
    expect(fare.totalFils).toBe(21_000);
  });

  it('always returns whole fils and a total equal to its parts', () => {
    for (const meters of [0, 1, 333, 9_999, 14_201, 123_457]) {
      const f = calculateFare(FLATBED, meters, DAY);
      for (const v of [f.distanceChargeFils, f.subtotalFils, f.vatFils, f.totalFils]) {
        expect(Number.isInteger(v)).toBe(true);
      }
      expect(f.subtotalFils).toBe(
        f.baseFareFils +
          f.distanceChargeFils +
          f.towTypeSurchargeFils +
          f.nightSurchargeFils +
          f.minimumFareAdjustmentFils,
      );
      expect(f.totalFils).toBe(f.subtotalFils + f.vatFils);
    }
  });

  it('rounds the distance charge to the nearest fils', () => {
    expect(calculateFare(FLATBED, 1, DAY).distanceChargeFils).toBe(0); // 0.48 fils
    expect(calculateFare(FLATBED, 2, DAY).distanceChargeFils).toBe(1); // 0.96 fils
  });

  it('rejects invalid distances', () => {
    expect(() => calculateFare(FLATBED, -1, DAY)).toThrow(RangeError);
    expect(() => calculateFare(FLATBED, Number.NaN, DAY)).toThrow(RangeError);
  });
});

describe('isUaeNightTime', () => {
  it.each([
    ['2026-10-07T19:59:00Z', false], // 23:59 Dubai
    ['2026-10-07T20:00:00Z', true], // 00:00 Dubai
    ['2026-10-08T01:59:00Z', true], // 05:59 Dubai
    ['2026-10-08T02:00:00Z', false], // 06:00 Dubai
  ])('%s → %s', (iso, expected) => {
    expect(isUaeNightTime(new Date(iso))).toBe(expected);
  });
});
