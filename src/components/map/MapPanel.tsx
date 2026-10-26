import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Truck } from 'lucide-react';
import { LocationItem, DriverPartner, TowType } from '../../types';
import { serviceTitle } from '../../services/catalog';

// Raster tile source. Configurable so the provider can change without code edits
// (OSM tile policy: https://operations.osmfoundation.org/policies/tiles/).
const TILE_URL = import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  import.meta.env.VITE_MAP_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
const DUBAI: L.LatLngTuple = [25.2048, 55.2708];

export interface MapPanelProps {
  pickup?: LocationItem;
  destination?: LocationItem;
  /** Drawn only when its currentLocation carries a real lat/lng (live GPS fix). */
  driver?: Pick<DriverPartner, 'currentLocation'>;
  towType?: TowType;
  /** Kept for callers; no route line is drawn until a road-routing provider exists. */
  showRoute?: boolean;
  etaMinutes?: number;
  /** Overrides the ETA text (e.g. "ETA unavailable"); no ETA is ever invented. */
  etaText?: string;
  interactive?: boolean;
  /** Tap on the map → the real WGS84 point. */
  onSelectLocation?: (point: { lat: number; lng: number }) => void;
  className?: string;
  height?: string;
}

const pointOf = (l?: { lat?: number; lng?: number }): L.LatLngTuple | null =>
  l?.lat != null && l?.lng != null ? [l.lat, l.lng] : null;

const dot = (at: L.LatLngTuple, color: string, label: string) =>
  L.circleMarker(at, { radius: 8, color: '#ffffff', weight: 3, fillColor: color, fillOpacity: 1 }).bindTooltip(label);

export const MapPanel: React.FC<MapPanelProps> = ({
  pickup,
  destination,
  driver,
  towType = 'flatbed',
  etaMinutes,
  etaText,
  interactive = true,
  onSelectLocation,
  className = '',
  height = 'h-full min-h-[360px]',
}) => {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  const onPick = useRef(onSelectLocation);
  onPick.current = onSelectLocation;

  const p = pointOf(pickup);
  const d = pointOf(destination);
  const drv = pointOf(driver?.currentLocation);

  useEffect(() => {
    const m = L.map(el.current!, {
      center: DUBAI,
      zoom: 11,
      zoomControl: false, // screens overlay their own corner buttons (back, SOS); pinch / wheel / double-click / keyboard zoom
      dragging: interactive,
      scrollWheelZoom: interactive,
      touchZoom: interactive,
      doubleClickZoom: interactive,
    });
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) =>
      onPick.current?.({ lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) }),
    );
    layers.current = L.layerGroup().addTo(m);
    map.current = m;
    // The container can be sized after mount (sheets, tabs) — keep tiles filling it.
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, [interactive]);

  // Markers follow the props (driver moves with each live GPS fix).
  useEffect(() => {
    const g = layers.current;
    if (!g) return;
    g.clearLayers();
    if (p) dot(p, '#101827', 'Pickup').addTo(g);
    if (d) dot(d, '#16865b', 'Destination').addTo(g);
    if (drv) dot(drv, '#1d4ed8', 'Tow truck (live)').addTo(g);
  }, [p?.[0], p?.[1], d?.[0], d?.[1], drv?.[0], drv?.[1]]);

  // Re-frame only when the trip points change, not on every driver update.
  useEffect(() => {
    const m = map.current;
    const pts = [p, d].filter(Boolean) as L.LatLngTuple[];
    if (!m || !pts.length) return;
    if (pts.length === 1) m.setView(pts[0], 14);
    else m.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 15 });
  }, [p?.[0], p?.[1], d?.[0], d?.[1], interactive]);

  return (
    <div className={`relative isolate w-full overflow-hidden bg-canvas rounded-2xl border border-line ${height} ${className}`}>
      <div ref={el} className="absolute inset-0 z-0" />

      {/* Trip card — kept clear of the bottom edge so the map attribution stays visible */}
      <div className="absolute bottom-7 left-3 right-3 z-[1000] flex items-center justify-between gap-2 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-surface/95 border border-line backdrop-blur-md shadow-xl text-xs flex-1 max-w-sm">
          <div className="w-8 h-8 rounded-lg bg-lime/20 border border-navy/20 text-navy flex items-center justify-center shrink-0">
            <Truck className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-ink">{serviceTitle(towType ?? 'flatbed')}</span>
            </div>
            <p className="text-[11px] text-muted truncate mt-0.5">
              {pickup?.name || 'Pickup not set'}
            </p>
          </div>
          <div className="text-right shrink-0 pl-1 border-l border-line">
            <div className="text-sm font-bold text-navy tabular-nums">
              {etaText ?? (etaMinutes !== undefined ? `${etaMinutes} min` : '—')}
            </div>
            <div className="text-[10px] text-muted">ETA arrival</div>
          </div>
        </div>
      </div>
    </div>
  );
};
