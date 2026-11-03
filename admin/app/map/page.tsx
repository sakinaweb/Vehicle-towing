'use client';

import 'leaflet/dist/leaflet.css';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ErrorBox, Shell, useLoad } from '../../components/Shell';
import { Badge, Empty } from '../../components/ui';
import { usePoll } from '../../components/usePoll';
import { DriverPin, getDriverLocations, when } from '../../lib/admin';

const UAE_CENTER: [number, number] = [24.6, 54.9];
const COLORS: Record<string, string> = { online: '#16865b', busy: '#b7791f', offline: '#697586' };

/** How old a position is, in words (positions older than ~2 min mean the GPS stopped). */
function age(iso: string | null) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : when(iso);
}

export default function DriverMapPage() {
  const [all, setAll] = useState(false);
  const { data, error, reload } = useLoad(() => getDriverLocations(all), [all]);
  usePoll(reload, 10_000);
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const fitted = useRef(false);

  // Leaflet touches `window`, so it is loaded in the browser only.
  useEffect(() => {
    let disposed = false;
    void import('leaflet').then((L) => {
      if (disposed || !box.current || map.current) return;
      map.current = L.map(box.current).setView(UAE_CENTER, 7);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(map.current);
      layer.current = L.layerGroup().addTo(map.current);
      draw(L, data ?? []);
    });
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (map.current) void import('leaflet').then((L) => draw(L, data ?? []));
  }, [data]);

  function draw(L: typeof import('leaflet'), pins: DriverPin[]) {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    for (const p of pins) {
      L.circleMarker([p.lat, p.lng], {
        radius: 9,
        color: '#fff',
        weight: 2,
        fillColor: COLORS[p.availability] ?? '#101827',
        fillOpacity: 0.95,
      })
        .bindPopup(
          `<strong>${escapeHtml(p.fullName ?? p.phone)}</strong><br>${escapeHtml(p.phone)}<br>` +
            `${escapeHtml(p.availability)}${p.activeBookingNumber ? ` · ${escapeHtml(p.activeBookingNumber)}` : ''}` +
            `<br><span style="color:#697586">Updated ${escapeHtml(age(p.locationUpdatedAt))}</span>`,
        )
        .addTo(layer.current);
    }
    if (!fitted.current && pins.length) {
      map.current.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lng])), { maxZoom: 12, padding: [40, 40] });
      fitted.current = true;
    }
  }

  return (
    <Shell title="Live map" subtitle="Approved drivers' last reported GPS positions. Refreshes every 10 seconds.">
      <div className="row" style={{ marginBottom: 14 }}>
        <div className="seg">
          <button className={!all ? 'on' : ''} onClick={() => setAll(false)}>
            Online now
          </button>
          <button className={all ? 'on' : ''} onClick={() => setAll(true)}>
            All (last known)
          </button>
        </div>
        <span className="muted">{data ? `${data.length} driver${data.length === 1 ? '' : 's'}` : 'Loading…'}</span>
      </div>
      <ErrorBox error={error} />
      <div
        ref={box}
        className="card"
        style={{ height: 460, padding: 0, overflow: 'hidden', marginBottom: 14 }}
        aria-label="Map of driver positions"
      />
      {data?.length === 0 && (
        <div className="card">
          <Empty title={all ? 'No driver has reported a position yet' : 'No driver is online'}>
            Drivers appear here once they go online in the TowNow Partner app.
          </Empty>
        </div>
      )}
      {!!data?.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Driver</th>
                <th>Status</th>
                <th>Current job</th>
                <th>Position</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.driverId}>
                  <td>
                    <Link href={`/drivers/${p.driverId}`}>{p.fullName ?? p.phone}</Link>
                    <div className="muted">{p.phone}</div>
                  </td>
                  <td>
                    <Badge status={p.availability} />
                  </td>
                  <td>{p.activeBookingNumber ?? '—'}</td>
                  <td className="muted">
                    {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                  </td>
                  <td>{age(p.locationUpdatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
