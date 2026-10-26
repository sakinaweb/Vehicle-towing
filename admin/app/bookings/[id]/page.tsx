'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ErrorBox, Shell, useLoad } from '../../../components/Shell';
import { Badge, Kpi, SkeletonRows, useFeedback } from '../../../components/ui';
import { aed, cancelBooking, errorText, getBooking, when } from '../../../lib/admin';

export default function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useLoad(() => getBooking(id), [id]);
  const { confirm, toast } = useFeedback();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const b = data?.summary;
  const open = b && b.status !== 'completed' && b.status !== 'cancelled';

  async function cancel() {
    if (
      !(await confirm({
        title: `Cancel ${b?.bookingNumber}?`,
        message: 'The driver is released and the customer is notified. This cannot be undone.',
        confirm: 'Cancel job',
        danger: true,
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      await cancelBooking(id, reason.trim());
      setReason('');
      toast('Job cancelled');
      reload();
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      title={b ? `Job ${b.bookingNumber}` : 'Job'}
      subtitle={b ? `Created ${when(b.createdAt)}` : undefined}
      crumbs={[{ href: '/bookings', label: 'Jobs' }, { label: b?.bookingNumber ?? '…' }]}
      actions={b && <Badge status={b.status} />}
    >
      <ErrorBox error={error} />
      {!data && !error && <SkeletonRows rows={3} cols={4} />}
      {data && b && (
        <>
          <div className="grid">
            <Kpi dark icon="money" label="Fare (incl. VAT)" value={aed(b.totalFils)} hint={`${b.paymentMethod} · ${data.paymentStatus ?? 'payment not recorded'}`} />
            <Kpi icon="fares" label="Receipt" value={data.invoiceNumber ?? '—'} hint={data.invoiceNumber ? 'Issued at completion' : 'Issued when completed'} />
            <Kpi icon="check" label="Inspections" value={`${data.inspections} / 2`} hint="Pickup and return" />
            <Kpi icon="drivers" label="Rating" value={b.customerRating ? `${b.customerRating}★` : '—'} hint={data.customerReview ?? undefined} />
          </div>
          <div className="grid-2" style={{ marginTop: 28 }}>
            <div>
              <h2 style={{ marginTop: 0 }}>Timeline</h2>
              <div className="card">
                <ul className="timeline">
                  {data.history.map((h, i) => (
                    <li key={i}>
                      <span className="dot" />
                      <div>
                        <Badge status={h.toStatus} />
                        {h.note && <div className="muted" style={{ marginTop: 4 }}>{h.note}</div>}
                      </div>
                      <span className="muted num">{when(h.at)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div>
              <h2 style={{ marginTop: 0 }}>People & route</h2>
              <div className="card" style={{ display: 'grid', gap: 12 }}>
                <div>
                  <div className="muted">Customer</div>
                  <strong>{b.customerName ?? '—'}</strong>
                  <div className="muted">{b.customerPhone}</div>
                </div>
                <div>
                  <div className="muted">Driver</div>
                  {b.driverId ? (
                    <Link href={`/drivers/${b.driverId}`}>{b.driverName ?? b.driverPhone}</Link>
                  ) : (
                    <strong>Not assigned</strong>
                  )}
                  {b.driverPhone && <div className="muted">{b.driverPhone}</div>}
                </div>
                <div>
                  <div className="muted">Pickup</div>
                  <strong>{b.pickupAddress}</strong>
                </div>
                <div>
                  <div className="muted">Drop-off</div>
                  <strong>{b.dropoffAddress}</strong>
                </div>
                {data.cancellationReason && <div className="error">Cancelled: {data.cancellationReason}</div>}
              </div>
              {open && (
                <>
                  <h2>Intervene</h2>
                  <div className="card" style={{ display: 'grid', gap: 10 }}>
                    <label className="field">
                      Reason (saved in the job history)
                      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer phoned: vehicle started" />
                    </label>
                    <button className="danger" disabled={busy || reason.trim().length < 3} onClick={() => void cancel()}>
                      Cancel job
                    </button>
                    <span className="muted" style={{ fontSize: 12 }}>
                      Manual reassignment isn&apos;t supported by the API yet — cancel, and the customer can rebook.
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}
