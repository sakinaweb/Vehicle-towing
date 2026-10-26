'use client';

import Link from 'next/link';
import { ErrorBox, Shell, useLoad } from '../../components/Shell';
import { Empty, Kpi, SkeletonRows } from '../../components/ui';
import { aed, getCommissions, when } from '../../lib/admin';

/** Cash model: drivers collect the fare and owe TowNow the commission (+VAT). */
export default function CommissionsPage() {
  const { data, error } = useLoad(getCommissions);
  const owed = (data ?? []).filter((b) => b.balanceFils < 0).reduce((a, b) => a - b.balanceFils, 0);
  const due = (data ?? []).filter((b) => b.balanceFils > 0).reduce((a, b) => a + b.balanceFils, 0);
  return (
    <Shell
      title="Commission ledger"
      subtitle="Driver settlement balances. Open a driver to record a remittance or payout."
    >
      <ErrorBox error={error} />
      {data && (
        <div className="grid" style={{ marginBottom: 20 }}>
          <Kpi dark icon="money" label="Outstanding from drivers" value={aed(owed)} hint="Commission + VAT on cash trips" />
          <Kpi icon="money" label="Owed to drivers" value={aed(due)} hint="Card-trip earnings to pay out" />
          <Kpi icon="drivers" label="Drivers with activity" value={data.length} />
        </div>
      )}
      {!data && !error && <SkeletonRows rows={5} cols={5} />}
      {data && data.length === 0 && (
        <div className="card">
          <Empty title="No completed trips yet">Balances appear after the first completed job.</Empty>
        </div>
      )}
      {data && data.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Driver</th>
                <th>Trips</th>
                <th style={{ textAlign: 'right' }}>Balance</th>
                <th>Last settlement</th>
              </tr>
            </thead>
            <tbody>
              {data.map((b) => (
                <tr key={b.driverId}>
                  <td>
                    <Link href={`/drivers/${b.driverId}`}>{b.fullName ?? 'Unnamed driver'}</Link>
                    <span className="sub">{b.phone}</span>
                  </td>
                  <td>{b.completedTrips}</td>
                  <td className={`num ${b.balanceFils < 0 ? 'danger-text' : b.balanceFils > 0 ? 'ok' : 'muted'}`} style={{ textAlign: 'right', fontWeight: 800 }}>
                    {b.balanceFils < 0 ? `owes ${aed(-b.balanceFils)}` : b.balanceFils > 0 ? `owed ${aed(b.balanceFils)}` : 'settled'}
                  </td>
                  <td className="muted">{when(b.lastSettlementAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
