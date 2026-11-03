'use client';

import { useState } from 'react';
import { ErrorBox, Shell, useLoad } from '../../components/Shell';
import { Empty, SkeletonRows } from '../../components/ui';
import { listAudit, when } from '../../lib/admin';

const FILTERS = [
  ['', 'All'],
  ['auth', 'Sign-ins'],
  ['kyc', 'KYC'],
  ['booking', 'Jobs'],
  ['payment', 'Payments'],
  ['dispute', 'Disputes'],
  ['sos', 'SOS'],
] as const;

export default function AuditPage() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const { data, error } = useLoad(() => listAudit(action, page), [action, page]);
  return (
    <Shell title="Audit log" subtitle="Who did what, and when. Read-only.">
      <div className="seg" style={{ marginBottom: 14 }}>
        {FILTERS.map(([value, label]) => (
          <button
            key={value}
            className={action === value ? 'on' : ''}
            onClick={() => {
              setAction(value);
              setPage(1);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <ErrorBox error={error} />
      {!data && !error && <SkeletonRows rows={8} cols={4} />}
      {data?.items.length === 0 && (
        <div className="card">
          <Empty title="Nothing recorded" />
        </div>
      )}
      {!!data?.items.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>By</th>
                <th>On</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((a) => (
                <tr key={a.id}>
                  <td>{when(a.createdAt)}</td>
                  <td>
                    <code>{a.action}</code>
                  </td>
                  <td>
                    {a.actorName ?? a.actorPhone ?? 'system'}
                    {a.actorRole && <div className="muted">{a.actorRole}</div>}
                  </td>
                  <td className="muted">
                    {a.entityType}
                    {a.entityId && <div style={{ fontSize: 11 }}>{a.entityId.slice(0, 8)}</div>}
                  </td>
                  <td className="muted" style={{ fontSize: 12, maxWidth: 360, wordBreak: 'break-word' }}>
                    {Object.keys(a.metadata).length ? JSON.stringify(a.metadata) : '—'}
                    {a.ip && <div>IP {a.ip}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && (
        <div className="row" style={{ marginTop: 14 }}>
          <button disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span className="muted">
            Page {page} of {Math.max(1, Math.ceil(data.total / data.limit))}
          </span>
          <button disabled={page * data.limit >= data.total} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </Shell>
  );
}
