'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ErrorBox, Shell, useLoad } from '../../components/Shell';
import { Badge, Empty, SkeletonRows } from '../../components/ui';
import { api, getKycQueue, when } from '../../lib/admin';
import type { KycStatus } from '@shared/services/dispatch';

const TABS: [KycStatus, string][] = [
  ['pending', 'Awaiting review'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['suspended', 'Suspended'],
];

export default function DriversPage() {
  const [status, setStatus] = useState<KycStatus>('pending');
  const { data, error } = useLoad(() => getKycQueue(api, status, 1, 50), [status]);

  return (
    <Shell title="Drivers & KYC" subtitle="Verify operators before they can receive jobs.">
      <div className="seg" style={{ marginBottom: 14 }}>
        {TABS.map(([s, label]) => (
          <button key={s} className={s === status ? 'on' : ''} onClick={() => setStatus(s)}>
            {label}
          </button>
        ))}
      </div>
      <ErrorBox error={error} />
      {!data && !error && <SkeletonRows rows={5} cols={6} />}
      {data && data.items.length === 0 && (
        <div className="card">
          <Empty title="Nobody here">No drivers with this status.</Empty>
        </div>
      )}
      {data && data.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Driver</th>
                <th>KYC</th>
                <th>Now</th>
                <th>Documents</th>
                <th>Trucks</th>
                <th>Registered</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((d) => (
                <tr key={d.driverId}>
                  <td>
                    <Link href={`/drivers/${d.driverId}`}>{d.fullName ?? 'Unnamed driver'}</Link>
                    <span className="sub">{d.phone}</span>
                  </td>
                  <td>
                    <Badge status={d.kycStatus} />
                  </td>
                  <td>{d.availability ? <Badge status={d.availability} /> : '—'}</td>
                  <td className={d.documentsUploaded < d.documentsRequired ? 'danger-text' : 'ok'}>
                    <strong>
                      {d.documentsUploaded}/{d.documentsRequired}
                    </strong>
                  </td>
                  <td>{d.towTrucks}</td>
                  <td className="muted">{when(d.registeredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
