import type { Point } from 'typeorm';

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Simplified outline of the UAE (mainland, coastal islands, Hatta and the east
 * coast), WGS84 "lng lat" pairs. Coarse on purpose — it rejects foreign or
 * nonsense coordinates (Qatar, Oman's Musandam, swapped lat/lng, 0,0). Exact
 * serviceability will come from service-zone polygons (service_zones table).
 */
export const UAE_OUTLINE_WKT =
  'POLYGON((51.58 24.25, 51.60 24.62, 52.20 25.00, 53.00 25.35, 54.30 25.40, 55.00 25.70, ' +
  '55.70 26.05, 56.10 26.10, 56.10 25.62, 56.40 25.60, 56.45 24.95, 56.10 24.75, 55.85 24.30, ' +
  '55.98 24.00, 55.20 22.70, 52.58 22.94, 51.58 24.25))';

/** GeoJSON uses [longitude, latitude] order. */
export function toPoint({ lat, lng }: LatLng): Point {
  return { type: 'Point', coordinates: [lng, lat] };
}

export function fromPoint(point: Point): LatLng {
  const [lng, lat] = point.coordinates;
  return { lat, lng };
}
