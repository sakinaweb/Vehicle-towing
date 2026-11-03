'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ErrorBox, Shell, useLoad } from '../../components/Shell';
import { Badge, Empty, SkeletonRows, useFeedback } from '../../components/ui';
import { usePoll } from '../../components/usePoll';
import { acknowledgeSos, errorText, listSos, resolveSos, Sos, when } from '../../lib/admin';

export default function SosPage() {
  const [resolved, setResolved] = useState(false);
  const { data, error, reload } = useLoad(() => listSos(resolved ? 'resolved' : undefined), [resolved]);
  usePoll(reload, 10_000);
  return (
    <Shell title="SOS" subtitle="Emergencies raised from the apps. Refreshes every 10 seconds — act on open ones first.">
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={!resolved ? 'on' : ''} onClick={() => setResolved(false)}>
          Active
        </button>
        <button className={resolved ? 'on' : ''} onClick={() => setResolved(true)}>
          Resolved
        </button>
      </div>
      <ErrorBox error={error} />
      {!data && !error && <SkeletonRows rows={3} cols={3} />}
      {data?.length === 0 && (
        <div className="card">
          <Empty title={resolved ? 'No resolved SOS yet' : 'No active SOS'}>
            {resolved ? '' : 'Nobody needs emergency help right now.'}
          </Empty>
        </div>
      )}
      <div style={{ display: 'grid', gap: 12 }}>
        {data?.map((s) => <SosCard key={s.id} sos={s} onDone={reload} />)}
      </div>
    </Shell>
  );
}

function SosCard({ sos: s, onDone }: { sos: Sos; onDone: () => void }) {
  const { toast } = useFeedback();
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast(done);
      onDone();
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card" style={{ borderColor: s.status === 'open' ? 'var(--error, #d64545)' : undefined }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>
          {s.raisedByName ?? s.raisedByPhone} ({s.raisedByRole})
        </strong>
        <Badge status={s.status === 'acknowledged' ? 'pending' : s.status} label={s.status} />
      </div>
      <div className="muted" style={{ margin: '6px 0' }}>
        {when(s.createdAt)} · <a href={`tel:${s.raisedByPhone}`}>{s.raisedByPhone}</a>
        {s.bookingId && (
          <>
            {' · '}
            <Link href={`/bookings/${s.bookingId}`}>{s.bookingNumber}</Link>
          </>
        )}
      </div>
      {s.note && <p style={{ margin: '6px 0' }}>{s.note}</p>}
      <div style={{ margin: '6px 0' }}>
        {s.lat != null && s.lng != null ? (
          <a
            href={`https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lng}#map=17/${s.lat}/${s.lng}`}
            target="_blank"
            rel="noreferrer"
          >
            Location {s.lat.toFixed(5)}, {s.lng.toFixed(5)}
            {s.accuracyMeters != null && ` (±${Math.round(s.accuracyMeters)} m)`}
          </a>
        ) : (
          <span className="muted">No location (GPS unavailable on the phone) — call them.</span>
        )}
      </div>
      {s.resolution && <div className="muted">Resolution: {s.resolution}</div>}
      {s.status !== 'resolved' && (
        <div className="row" style={{ marginTop: 10 }}>
          {s.status === 'open' && (
            <button disabled={busy} onClick={() => void act(() => acknowledgeSos(s.id), 'Acknowledged — the user is told help is coming')}>
              Acknowledge
            </button>
          )}
          <input
            style={{ flex: 1, minWidth: 200 }}
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="What was done (e.g. police attended)"
          />
          <button
            className="danger"
            disabled={busy}
            onClick={() => void act(() => resolveSos(s.id, resolution.trim()), 'SOS resolved')}
          >
            Resolve
          </button>
        </div>
      )}
    </div>
  );
}
