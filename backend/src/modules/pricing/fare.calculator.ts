/**
 * TowNow fare calculation. All money is integer fils (1 AED = 100 fils), rates
 * are basis points (500 bps = 5%), so the result is exact and reproducible.
 *
 *   subtotal = max(minimum fare, base + distance + tow-type surcharge + night surcharge)
 *   VAT      = round(subtotal × 5%)            (UAE VAT, half-up to the fils)
 *   total    = subtotal + VAT
 */

export interface TariffInput {
  baseFareFils: number;
  perKmFils: number;
  minimumFareFils: number;
  towTypeSurchargeFils: number;
  nightSurchargeFils: number;
  vatRateBps: number;
  currency: string;
}

export interface FareBreakdown {
  baseFareFils: number;
  distanceChargeFils: number;
  towTypeSurchargeFils: number;
  nightSurchargeFils: number;
  /** Top-up so the subtotal reaches the minimum fare (0 when not needed). */
  minimumFareAdjustmentFils: number;
  subtotalFils: number;
  vatRateBps: number;
  vatFils: number;
  totalFils: number;
  currency: string;
}

/** Night surcharge window, UAE local time (UTC+4, no daylight saving): 00:00–05:59. */
export const NIGHT_START_HOUR = 0;
export const NIGHT_END_HOUR = 6;
const UAE_UTC_OFFSET_HOURS = 4;

export function isUaeNightTime(at: Date): boolean {
  const localHour = (at.getUTCHours() + UAE_UTC_OFFSET_HOURS) % 24;
  return localHour >= NIGHT_START_HOUR && localHour < NIGHT_END_HOUR;
}

export function calculateFare(
  tariff: TariffInput,
  distanceMeters: number,
  at: Date,
): FareBreakdown {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new RangeError('distanceMeters must be a non-negative number');
  }
  const distanceChargeFils = Math.round((distanceMeters * tariff.perKmFils) / 1000);
  const nightSurchargeFils = isUaeNightTime(at) ? tariff.nightSurchargeFils : 0;
  const beforeMinimum =
    tariff.baseFareFils + distanceChargeFils + tariff.towTypeSurchargeFils + nightSurchargeFils;
  const minimumFareAdjustmentFils = Math.max(0, tariff.minimumFareFils - beforeMinimum);
  const subtotalFils = beforeMinimum + minimumFareAdjustmentFils;
  const vatFils = Math.round((subtotalFils * tariff.vatRateBps) / 10_000);

  return {
    baseFareFils: tariff.baseFareFils,
    distanceChargeFils,
    towTypeSurchargeFils: tariff.towTypeSurchargeFils,
    nightSurchargeFils,
    minimumFareAdjustmentFils,
    subtotalFils,
    vatRateBps: tariff.vatRateBps,
    vatFils,
    totalFils: subtotalFils + vatFils,
    currency: tariff.currency,
  };
}
