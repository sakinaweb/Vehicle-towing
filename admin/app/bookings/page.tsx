'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ErrorBox, Shell, useLoad } from '../../components/Shell';
import { Badge, Empty, SkeletonRows } from '../../components/ui';
import { aed, BookingFilter, listBookings, when } from '../../lib/admin';

const FILTERS: [BookingFilter, string][] = [
  ['active', 'Open'],
  ['completed', 'Completed'],
  ['cancelled', 'Cancelled'],
  ['all', 'All'],
];

export default function BookingsPage() {
  return (
    <Suspense>
      <Bookings />
    </Suspense>
  );
}

function Bookings() {
  const router = useRouter();
  const params = useSearchParams();
  const status = (params.get('status') as BookingFilter) || 'active';
  const query = params.get('q') ?? '';
  const [q, setQ] = useState(query);
  const [page, setPage] = useState(1);
  useEffect(() => {
    setQ(query);
    setPage(1);
  }, [query, status]);
  const { data, error } = useLoad(() => listBookings(status, query, page), [status, query, page]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const go = (next: { status?: BookingFilter; q?: string }) => {
    const s = new URLSearchParams({ status: next.status ?? status });
    const nq = next.q ?? query;
    if (nq) s.set('q', nq);
    router.push(`/bookings?${s}`);
  };

  return (
    <Shell title="Jobs" subtitle={data ? `${data.total} jobs` : 'All tow requests'}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <div className="seg" role="tablist">
          {FILTERS.map(([value, label]) => (
            <button key={value} className={status === value ? 'on' : ''} onClick={() => go({ status: value })}>
              {label}
            </button>
          ))}
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: q.trim() });
          }}
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Booking no. or phone" />
          <button className="dark">Search</button>
          {query && (
            <button type="button" className="ghost" onClick={() => go({ q: '' })}>
              Clear
            </button>
          )}
        </form>
      </div>
      <ErrorBox error={error} />
      {!data && !error && <SkeletonRows rows={6} cols={7} />}
      {data && data.items.length === 0 && (
        <div className="card">
          <Empty title="No jobs match">{query ? `Nothing found for “${query}”.` : 'Try another filter.'}</Empty>
        </div>
      )}
      {data && data.items.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Status</th>
                  <th>Customer</th>
                  <th>Driver</th>
                  <th>Route</th>
                  <th>Fare</th>
                  <th>Rating</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link href={`/bookings/${b.id}`}>{b.bookingNumber}</Link>
                      <span className="sub">{b.paymentMethod}</span>
                    </td>
                    <td>
                      <Badge status={b.status} />
                    </td>
                    <td>
                      {b.customerName ?? '—'}
                      <span className="sub">{b.customerPhone}</span>
                    </td>
                    <td>
                      {b.driverName ?? '—'}
                      <span className="sub">{b.driverPhone ?? ''}</span>
                    </td>
                    <td style={{ maxWidth: 280 }}>
                      {b.pickupAddress}
                      <span className="sub">→ {b.dropoffAddress}</span>
                    </td>
                    <td className="num">{aed(b.totalFils)}</td>
                    <td>{b.customerRating ? `${b.customerRating}★` : <span className="muted">—</span>}</td>
                    <td className="muted">{when(b.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
            <span className="muted">
              Page {page} of {pages}
            </span>
            <button className="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <button className="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </div>
        </>
      )}
    </Shell>
  );
}
