import { Controller, Get, Injectable, Logger, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { AppConfigService } from '../../config/app-config.service.js';
import { RoutingProviderName } from '../../config/env.validation.js';
import { Trim } from '../../common/validation/string.decorators.js';

export interface Place {
  address: string;
  lat: number;
  lng: number;
}

const TIMEOUT_MS = 5_000;
const LIMIT = 5;

/** Google Geocoding API, restricted to the UAE, English addresses. */
export async function googleGeocode(q: string, key: string, fetchImpl: typeof fetch = fetch) {
  const url =
    'https://maps.googleapis.com/maps/api/geocode/json' +
    `?address=${encodeURIComponent(q)}&components=country:AE&language=en&region=ae` +
    `&key=${encodeURIComponent(key)}`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Google Geocoding HTTP ${res.status}`);
  const body = (await res.json()) as {
    status: string;
    results?: { formatted_address: string; geometry: { location: { lat: number; lng: number } } }[];
  };
  if (body.status !== 'OK' && body.status !== 'ZERO_RESULTS') {
    throw new Error(`Google Geocoding status ${body.status}`);
  }
  return (body.results ?? []).map((r) => ({
    address: r.formatted_address,
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
  }));
}

/** Mapbox Geocoding (v5), restricted to the UAE, English place names. */
export async function mapboxGeocode(q: string, token: string, fetchImpl: typeof fetch = fetch) {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
    `?country=ae&language=en&limit=${LIMIT}&access_token=${encodeURIComponent(token)}`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Mapbox Geocoding HTTP ${res.status}`);
  const body = (await res.json()) as {
    features?: { place_name: string; center: [number, number] }[];
  };
  return (body.features ?? []).map((f) => ({
    address: f.place_name,
    lng: f.center[0],
    lat: f.center[1],
  }));
}

export class PlaceSearchQuery {
  @ApiProperty({ example: 'Dubai Mall', minLength: 3, maxLength: 120 })
  @Trim()
  @IsString()
  @Length(3, 120)
  q!: string;
}

export class PlaceView {
  @ApiProperty() address!: string;
  @ApiProperty() lat!: number;
  @ApiProperty() lng!: number;
}

export class PlaceSearchView {
  @ApiProperty({ enum: ['available', 'unavailable'] }) status!: 'available' | 'unavailable';
  @ApiPropertyOptional({ enum: ['not_configured', 'provider_error'] })
  reason?: 'not_configured' | 'provider_error';
  @ApiProperty({ type: [PlaceView] }) results!: PlaceView[];
}

/**
 * Address search through the routing provider's geocoder (the same key as ETAs).
 * Keys stay on the server. With ROUTING_PROVIDER=none it says so instead of guessing.
 */
@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(q: string): Promise<PlaceSearchView> {
    const { provider, googleApiKey, mapboxToken } = this.config.routing;
    const geocode =
      provider === RoutingProviderName.Google
        ? () => googleGeocode(q, googleApiKey!, this.fetchImpl)
        : provider === RoutingProviderName.Mapbox
          ? () => mapboxGeocode(q, mapboxToken!, this.fetchImpl)
          : null;
    if (!geocode) return { status: 'unavailable', reason: 'not_configured', results: [] };
    try {
      const results = (await geocode()).slice(0, LIMIT); // both APIs are restricted to the UAE
      return { status: 'available', results };
    } catch (err) {
      this.logger.warn(`Geocoding via ${provider} failed: ${String(err)}`);
      return { status: 'unavailable', reason: 'provider_error', results: [] };
    }
  }
}

@ApiTags('Locations')
@ApiBearerAuth()
@Controller('locations')
export class LocationsController {
  constructor(private readonly geocoding: GeocodingService) {}

  @Get('search')
  @ApiOperation({ summary: 'Find a UAE address (pickup / destination search)' })
  @ApiOkResponse({ type: PlaceSearchView })
  search(@Query() query: PlaceSearchQuery): Promise<PlaceSearchView> {
    return this.geocoding.search(query.q);
  }
}
