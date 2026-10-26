import { Logger } from '@nestjs/common';
import type { AppConfigService } from '../../config/app-config.service.js';
import { EtaService } from './eta.service.js';

const A = { lat: 25.1972, lng: 55.2744 };
const B = { lat: 25.1386, lng: 55.2266 };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const configWith = (routing: Record<string, unknown>) =>
  ({
    routing: { googleApiKey: 'gkey', mapboxToken: 'mtoken', ...routing },
  }) as unknown as AppConfigService;

describe('EtaService', () => {
  beforeAll(() => vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));

  it('reports "not configured" instead of inventing an ETA', async () => {
    const fetchMock = vi.fn();
    const eta = new EtaService(configWith({ provider: 'none' }), fetchMock);
    await expect(eta.estimate(A, B)).resolves.toEqual({
      status: 'unavailable',
      reason: 'not_configured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the Google Routes API with the key in a header', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json(200, { routes: [{ duration: '734s', distanceMeters: 10450 }] }));
    const eta = new EtaService(configWith({ provider: 'google' }), fetchMock);
    await expect(eta.estimate(A, B)).resolves.toEqual({
      status: 'available',
      durationSeconds: 734,
      distanceMeters: 10450,
      source: 'google',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    expect((init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('gkey');
    expect(JSON.parse(init.body as string)).toMatchObject({
      origin: { location: { latLng: { latitude: A.lat, longitude: A.lng } } },
      travelMode: 'DRIVE',
    });
  });

  it('uses Mapbox Directions (lng,lat order)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json(200, { routes: [{ duration: 601.4, distance: 9876.6 }] }));
    const eta = new EtaService(configWith({ provider: 'mapbox' }), fetchMock);
    await expect(eta.estimate(A, B)).resolves.toEqual({
      status: 'available',
      durationSeconds: 601,
      distanceMeters: 9877,
      source: 'mapbox',
    });
    expect(fetchMock.mock.calls[0][0]).toContain(
      `/driving-traffic/${A.lng},${A.lat};${B.lng},${B.lat}?`,
    );
  });

  it('degrades to "unavailable" on provider errors or no route', async () => {
    const failing = new EtaService(
      configWith({ provider: 'google' }),
      vi.fn().mockResolvedValue(json(403, {})),
    );
    await expect(failing.estimate(A, B)).resolves.toEqual({
      status: 'unavailable',
      reason: 'provider_error',
    });
    const noRoute = new EtaService(
      configWith({ provider: 'mapbox' }),
      vi.fn().mockResolvedValue(json(200, { routes: [] })),
    );
    await expect(noRoute.estimate(A, B)).resolves.toEqual({
      status: 'unavailable',
      reason: 'no_route',
    });
    const offline = new EtaService(
      configWith({ provider: 'mapbox' }),
      vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    );
    await expect(offline.estimate(A, B)).resolves.toEqual({
      status: 'unavailable',
      reason: 'provider_error',
    });
  });
});
