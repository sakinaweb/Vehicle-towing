'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ErrorBox, Shell, useLoad } from '../../components/Shell';
import { Badge, Empty, SkeletonRows, useFeedback } from '../../components/ui';
import { Dispute, errorText, listDisputes, resolveDispute, when } from '../../lib/admin';

export default function DisputesPage() {
  const [status, setStatus] = useState<Dispute['status']>('open');
  const { data, error, reload } = useLoad(() => listDisputes(status), [status]);
  return (
    <Shell title="Disputes" subtitle="Problems raised by customers and drivers about a job.">
      <div className="seg" style={{ marginBottom: 14 }}>
        {(['open', 'resolved', 'rejected'] as const).map((s) => (
          <button key={s} className={s === status ? 'on' : ''} onClick={() => setStatus(s)}>
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      <ErrorBox error={error} />
      {!data && !error && <SkeletonRows rows={3} cols={3} />}
      {data?.length === 0 && (
        <div className="card">
          <Empty title={`No ${status} disputes`}>{status === 'open' ? 'Nothing needs a decision right now.' : ''}</Empty>
        </div>
      )}
      <div style={{ display: 'grid', gap: 12 }}>
        {data?.map((d) => <DisputeCard key={d.id} dispute={d} onDone={reload} />)}
      </div>
    </Shell>
  );
}

function DisputeCard({ dispute: d, onDone }: { dispute: Dispute; onDone: () => void }) {
  const { confirm, toast } = useFeedback();
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const decide = async (status: 'resolved' | 'rejected') => {
    if (
      !(await confirm({
        title: status === 'resolved' ? 'Resolve this dispute?' : 'Reject this dispute?',
        message: 'The decision is sent to the person who raised it and cannot be changed.',
        confirm: status === 'resolved' ? 'Resolve' : 'Reject',
        danger: status === 'rejected',
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      await resolveDispute(d.id, status, resolution.trim());
      toast(status === 'resolved' ? 'Dispute resolved' : 'Dispute rejected');
      onDone();
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <Link href={`/bookings/${d.bookingId}`}>{d.bookingNumber}</Link>
          <span className="badge tone-neutral">raised by {d.raisedByRole}</span>
          <span className="muted">{when(d.createdAt)}</span>
        </div>
        <Badge status={d.status} />
      </div>
      <p style={{ fontSize: 15, margin: '12px 0' }}>{d.reason}</p>
      {d.status === 'open' ? (
        <div className="row">
          <input
            style={{ flex: 1, minWidth: 240 }}
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="Decision (sent to the person who raised it)"
          />
          <button disabled={busy || resolution.trim().length < 5} onClick={() => void decide('resolved')}>
            Resolve
          </button>
          <button className="secondary" disabled={busy || resolution.trim().length < 5} onClick={() => void decide('rejected')}>
            Reject
          </button>
        </div>
      ) : (
        <div className="notice" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
          <strong>Decision</strong> ({when(d.resolvedAt)}): {d.resolution}
        </div>
      )}
    </div>
  );
}
