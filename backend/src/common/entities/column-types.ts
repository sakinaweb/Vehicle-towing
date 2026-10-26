import { ColumnOptions, ValueTransformer } from 'typeorm';

/** Postgres returns NUMERIC as string; expose it as number (safe for ratings/percentages, not money). */
export const numericTransformer: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) => (value === null || value === undefined ? value : Number(value)),
};

/** WGS84 geographic point (lng/lat) backed by PostGIS. */
export const geoPointColumn = (options: Partial<ColumnOptions> = {}): ColumnOptions => ({
  type: 'geography',
  spatialFeatureType: 'Point',
  srid: 4326,
  ...options,
});

/** Money is stored as integer minor units (fils: 1 AED = 100 fils) to avoid float rounding. */
export const moneyColumn = (options: Partial<ColumnOptions> = {}): ColumnOptions => ({
  type: 'integer',
  ...options,
});
