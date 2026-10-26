import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { RoutingProviderName } from '../../config/env.validation.js';
import { LatLng } from './geo.js';

export type EtaResult =
  | {
      status: 'available';
      durationSeconds: number;
      distanceMeters: number;
      /** Which provider produced it, e.g. "google", "mapbox". */
      source: string;
    }
  | {
      status: 'unavailable';
      /** Why there is no real ETA — shown honestly instead of a made-up number. */
      reason: 'not_configured' | 'provider_error' | 'no_route';
    };

/** A road-routing provider. Keys stay on the server, never in the apps. */
export interface EtaProvider {
  readonly name: string;
  route(
    from: LatLng,
    to: LatLng,
  ): Promise<{ durationSeconds: number; distanceMeters: number } | null>;
}

const TIMEOUT_MS = 5_000;

/** Google Routes API (computeRoutes), traffic-aware driving. */
export class GoogleRoutesProvider implements EtaProvider {
  readonly name = 'google';
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async route(from: LatLng, to: LatLng) {
    const res = await this.fetchImpl('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Google Routes HTTP ${res.status}`);
    const body = (await res.json()) as {
      routes?: { duration?: string; distanceMeters?: number }[];
    };
    const r = body.routes?.[0];
    if (!r?.duration) return null;
    return {
      durationSeconds: Math.round(parseFloat(r.duration)),
      distanceMeters: r.distanceMeters ?? 0,
    };
  }
}

/** Mapbox Directions API, driving with live traffic. */
export class MapboxDirectionsProvider implements EtaProvider {
  readonly name = 'mapbox';
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async route(from: LatLng, to: LatLng) {
    const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const url =
      `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}` +
      `?overview=false&access_token=${encodeURIComponent(this.token)}`;
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Mapbox Directions HTTP ${res.status}`);
    const body = (await res.json()) as { routes?: { duration: number; distance: number }[] };
    const r = body.routes?.[0];
    if (!r) return null;
    return { durationSeconds: Math.round(r.duration), distanceMeters: Math.round(r.distance) };
  }
}

/**
 * Driving ETA between two points via the configured provider. With
 * ROUTING_PROVIDER=none the answer is an explicit "unavailable", never a guess.
 */
@Injectable()
export class EtaService {
  private readonly logger = new Logger(EtaService.name);
  private readonly provider: EtaProvider | null;

  constructor(config: AppConfigService, fetchImpl: typeof fetch = fetch) {
    const { provider, googleApiKey, mapboxToken } = config.routing;
    this.provider =
      provider === RoutingProviderName.Google
        ? new GoogleRoutesProvider(googleApiKey!, fetchImpl)
        : provider === RoutingProviderName.Mapbox
          ? new MapboxDirectionsProvider(mapboxToken!, fetchImpl)
          : null;
  }

  async estimate(from: LatLng, to: LatLng): Promise<EtaResult> {
    if (!this.provider) return { status: 'unavailable', reason: 'not_configured' };
    try {
      const route = await this.provider.route(from, to);
      if (!route) return { status: 'unavailable', reason: 'no_route' };
      return { status: 'available', ...route, source: this.provider.name };
    } catch (err) {
      this.logger.warn(`ETA via ${this.provider.name} failed: ${String(err)}`);
      return { status: 'unavailable', reason: 'provider_error' };
    }
  }
}
