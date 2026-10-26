import { fromPoint, toPoint, UAE_OUTLINE_WKT } from './geo.js';

describe('geo helpers', () => {
  it('converts to and from GeoJSON (lng, lat order)', () => {
    const point = toPoint({ lat: 25.1972, lng: 55.2744 });
    expect(point).toEqual({ type: 'Point', coordinates: [55.2744, 25.1972] });
    expect(fromPoint(point)).toEqual({ lat: 25.1972, lng: 55.2744 });
  });

  it('has a closed UAE outline polygon', () => {
    const coords = UAE_OUTLINE_WKT.replace(/^POLYGON\(\(|\)\)$/g, '').split(', ');
    expect(coords.length).toBeGreaterThanOrEqual(4);
    expect(coords[0]).toBe(coords[coords.length - 1]);
  });
});
