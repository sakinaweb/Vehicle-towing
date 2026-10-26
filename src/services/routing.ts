import { LocationItem } from '../types';

export interface RouteEstimate {
  distanceKm: number;
  durationMinutes: number;
}

// Demo calibration for the stylised map (coordinates are 0-100 map percentages).
// Tuned so the default Downtown Dubai → Al Quoz route estimates ~14.2 km.
const DEMO_KM_PER_MAP_UNIT = 1.0;
const DEMO_ROAD_FACTOR = 1.32; // roads are longer than a straight line
const DEMO_AVG_SPEED_KMH = 40;

/**
 * Single source of truth for pickup → destination distance.
 * ponytail: straight-line estimate on demo map coordinates; replace the body with a
 * real routing API call (e.g. Google Directions / Mapbox) when the backend lands.
 */
export const estimateRoute = (from: LocationItem, to: LocationItem): RouteEstimate => {
  const dx = from.coordinates.x - to.coordinates.x;
  const dy = from.coordinates.y - to.coordinates.y;
  const km = Math.hypot(dx, dy) * DEMO_KM_PER_MAP_UNIT * DEMO_ROAD_FACTOR;
  const distanceKm = Math.max(1, Math.round(km * 10) / 10);
  return {
    distanceKm,
    durationMinutes: Math.max(1, Math.round((distanceKm / DEMO_AVG_SPEED_KMH) * 60)),
  };
};
