import { Logger } from '@nestjs/common';
import type { AppConfigService } from '../../config/app-config.service.js';
import { GeocodingService } from './geocoding.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const configWith = (provider: string) =>
  ({
    routing: { provider, googleApiKey: 'gkey', mapboxToken: 'mtoken' },
  }) as unknown as AppConfigService;

describe('GeocodingService', () => {
  beforeAll(() => vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));

  it('says "not configured" without calling anyone', async () => {
    const fetchMock = vi.fn();
    await expect(
      new GeocodingService(configWith('none'), fetchMock).search('Dubai Mall'),
    ).resolves.toEqual({
      status: 'unavailable',
      reason: 'not_configured',
      results: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('searches Google restricted to the UAE', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json(200, {
        status: 'OK',
        results: [
          {
            formatted_address: 'Dubai Mall - Dubai',
            geometry: { location: { lat: 25.1972, lng: 55.2796 } },
          },
        ],
      }),
    );
    const res = await new GeocodingService(configWith('google'), fetchMock).search('Dubai Mall');
    expect(res).toEqual({
      status: 'available',
      results: [{ address: 'Dubai Mall - Dubai', lat: 25.1972, lng: 55.2796 }],
    });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('components=country:AE');
    expect(url).toContain('language=en');
    expect(url).toContain('region=ae');
    expect(url).toContain('address=Dubai%20Mall');
  });

  it('searches Mapbox (lng,lat order) and reports provider errors honestly', async () => {
    const ok = vi
      .fn()
      .mockResolvedValue(
        json(200, { features: [{ place_name: 'JLT, Dubai', center: [55.14, 25.07] }] }),
      );
    await expect(new GeocodingService(configWith('mapbox'), ok).search('JLT')).resolves.toEqual({
      status: 'available',
      results: [{ address: 'JLT, Dubai', lat: 25.07, lng: 55.14 }],
    });
    expect(String(ok.mock.calls[0][0])).toContain('country=ae');
    expect(String(ok.mock.calls[0][0])).toContain('language=en');

    const denied = vi.fn().mockResolvedValue(json(200, { status: 'REQUEST_DENIED' }));
    await expect(new GeocodingService(configWith('google'), denied).search('JLT')).resolves.toEqual(
      {
        status: 'unavailable',
        reason: 'provider_error',
        results: [],
      },
    );
  });
});
