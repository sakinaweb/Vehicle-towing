import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LatLng, UAE_OUTLINE_WKT } from './geo.js';

export interface RouteEstimate {
  distanceMeters: number;
  durationSeconds: number;
  /** Where the numbers came from, kept for support and audits. */
  source: 'postgis-geodesic';
}

/**
 * Roads are longer than the straight line. 1.3 is the usual urban detour factor
 * and matches the original TowNow estimate (Downtown Dubai → Al Quoz ≈ 14 km).
 */
export const ROAD_FACTOR = 1.3;
/** Average tow-truck speed in UAE city traffic, for the duration estimate. */
export const AVERAGE_SPEED_KMH = 45;

/**
 * Route distance for pricing. Today: PostGIS geodesic distance × ROAD_FACTOR.
 * When a routing provider (Google Routes, Mapbox, HERE) is configured, only this
 * class changes — quotes already snapshot the distance and its source.
 */
@Injectable()
export class RoutingService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async estimate(from: LatLng, to: LatLng): Promise<RouteEstimate> {
    const meters = await this.geodesicMeters(from, to);
    const distanceMeters = Math.round(meters * ROAD_FACTOR);
    return {
      distanceMeters,
      durationSeconds: Math.round((distanceMeters / 1000 / AVERAGE_SPEED_KMH) * 3600),
      source: 'postgis-geodesic',
    };
  }

  /** True when the point lies inside the UAE (PostGIS ST_Covers on the outline polygon). */
  async isInUae(point: LatLng): Promise<boolean> {
    const rows: { covered: boolean }[] = await this.dataSource.query(
      `SELECT ST_Covers(ST_GeogFromText($1), ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) AS covered`,
      [UAE_OUTLINE_WKT, point.lng, point.lat],
    );
    return rows[0].covered;
  }

  /** Great-circle distance on the WGS84 spheroid, computed by PostGIS. */
  async geodesicMeters(from: LatLng, to: LatLng): Promise<number> {
    const rows: { meters: number }[] = await this.dataSource.query(
      `SELECT ST_Distance(
         ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
         ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
       ) AS meters`,
      [from.lng, from.lat, to.lng, to.lat],
    );
    return Number(rows[0].meters);
  }
}
