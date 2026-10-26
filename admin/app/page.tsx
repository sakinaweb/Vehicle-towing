'use client';

import Link from 'next/link';
import { ErrorBox, Shell, useLoad } from '../components/Shell';
import { Badge, Empty, Kpi, SkeletonRows } from '../components/ui';
import { aed, getOverview, listBookings, when } from '../lib/admin';

const STATUS_ORDER = [
  ['searching', 'Searching'],
  ['driver_assigned', 'Assigned'],
  ['driver_arriving', 'On the way'],
  ['driver_arrived', 'Arrived'],
  ['in_transit', 'Towing'],
] as const;

export default function OverviewPage() {
  const overview = useLoad(getOverview);
  const active = useLoad(() => listBookings('active'));
  const o = overview.data;
  const activeTotal = o ? Object.values(o.activeByStatus).reduce((a, b) => a + b, 0) : 0;
  const maxBar = o ? Math.max(1, ...Object.values(o.activeByStatus)) : 1;

  return (
    <Shell
      title="Overview"
      subtitle="Live operations and all-time totals from the TowNow database."
      actions={
        <button
          className="secondary"
          onClick={() => {
            overview.reload();
            active.reload();
          }}
        >
          Refresh
        </button>
      }
    >
      <ErrorBox error={overview.error ?? active.error} />
      {!o && !overview.error && <SkeletonRows rows={2} cols={4} />}
      {o && (
        <>
          <div className="grid">
            <Link href="/bookings" className="kpi-link">
              <Kpi dark icon="jobs" label="Active jobs" value={activeTotal} hint="Open right now" />
            </Link>
            <Kpi icon="wifi" label="Drivers online" value={o.driversOnline} hint="Approved and available" />
            <Link href="/drivers" className="kpi-link">
              <Kpi icon="drivers" label="KYC waiting" value={o.driversPendingKyc} hint="Pending review" />
            </Link>
            <Link href="/disputes" className="kpi-link">
              <Kpi icon="alert" label="Open disputes" value={o.openDisputes} />
            </Link>
          </div>
          <h2>Bookings</h2>
          <div className="grid">
            <Kpi icon="jobs" label="Total bookings" value={o.totalBookings} />
            <Kpi icon="check" label="Completed" value={o.completedBookings} hint={`${o.completedToday} today`} />
            <Kpi icon="alert" label="Cancelled" value={o.cancelledBookings} />
            <Kpi icon="clock" label="Gross today" value={<span className="num">{aed(o.grossTodayFils)}</span>} hint="Incl. VAT" />
          </div>
          <h2>Money</h2>
          <div className="grid">
            <Kpi icon="money" label="Gross (completed)" value={aed(o.grossAllTimeFils)} hint="All time, incl. VAT" />
            <Kpi icon="money" label="Commission earned" value={aed(o.commissionEarnedFils)} hint="Fare excl. VAT − driver earnings" />
            <Kpi icon="fares" label="VAT collected" value={aed(o.vatAllTimeFils)} hint="5% on completed jobs" />
            <Link href="/commissions" className="kpi-link">
              <Kpi icon="money" label="Owed by drivers" value={aed(o.commissionOwedFils)} hint="Cash-trip commission + VAT" />
            </Link>
          </div>
          <div className="grid-2" style={{ marginTop: 28 }}>
            <div>
              <h2 style={{ marginTop: 0 }}>Live jobs</h2>
              {!active.data ? (
                <SkeletonRows rows={4} cols={5} />
              ) : active.data.items.length === 0 ? (
                <div className="card">
                  <Empty title="No open jobs right now">New bookings appear here as soon as they are placed.</Empty>
                </div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Job</th>
                        <th>Status</th>
                        <th>Driver</th>
                        <th>Fare</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {active.data.items.map((b) => (
                        <tr key={b.id}>
                          <td>
                            <Link href={`/bookings/${b.id}`}>{b.bookingNumber}</Link>
                            <span className="sub">{b.pickupAddress}</span>
                          </td>
                          <td>
                            <Badge status={b.status} />
                          </td>
                          <td>{b.driverName ?? <span className="muted">Searching…</span>}</td>
                          <td className="num">{aed(b.totalFils)}</td>
                          <td className="muted">{when(b.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div>
              <h2 style={{ marginTop: 0 }}>Open jobs by stage</h2>
              <div className="card bars">
                {STATUS_ORDER.map(([key, label]) => {
                  const n = o.activeByStatus[key] ?? 0;
                  return (
                    <div className="bar-row" key={key}>
                      <span>{label}</span>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${(n / maxBar) * 100}%` }} />
                      </div>
                      <strong className="num" style={{ textAlign: 'right' }}>
                        {n}
                      </strong>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}
