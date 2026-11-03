'use client';

import { useState } from 'react';
import { ErrorBox, Shell, useLoad } from '../../components/Shell';
import { Badge, Empty, SkeletonRows, useFeedback } from '../../components/ui';
import {
  aed,
  CustomerRow,
  errorText,
  listCustomers,
  reactivateUser,
  suspendUser,
  when,
} from '../../lib/admin';

export default function CustomersPage() {
  const [status, setStatus] = useState<'' | 'active' | 'suspended'>('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, reload } = useLoad(() => listCustomers(search, status, page), [search, status, page]);
  return (
    <Shell title="Customers" subtitle="Everyone who signed up in the TowNow app, with their tows and spend.">
      <div className="row" style={{ marginBottom: 14 }}>
        <div className="seg">
          {([
            ['', 'All'],
            ['active', 'Active'],
            ['suspended', 'Suspended'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              className={status === value ? 'on' : ''}
              onClick={() => {
                setStatus(value);
                setPage(1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q.trim());
            setPage(1);
          }}
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Phone or name" aria-label="Search customers" />
          <button type="submit">Search</button>
        </form>
      </div>
      <ErrorBox error={error} />
      {!data && !error && <SkeletonRows rows={6} cols={6} />}
      {data?.items.length === 0 && (
        <div className="card">
          <Empty title="No customers found" />
        </div>
      )}
      {!!data?.items.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Status</th>
                <th>Tows</th>
                <th style={{ textAlign: 'right' }}>Spent</th>
                <th>Joined</th>
                <th>Last tow</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <CustomerRowView key={c.userId} c={c} onDone={reload} />
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
            Page {page} · {data.total} customers
          </span>
          <button disabled={page * data.limit >= data.total} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </Shell>
  );
}

function CustomerRowView({ c, onDone }: { c: CustomerRow; onDone: () => void }) {
  const { confirm, toast } = useFeedback();
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const suspended = c.status === 'suspended';

  async function change() {
    if (
      !(await confirm({
        title: suspended ? `Reactivate ${c.phone}?` : `Suspend ${c.phone}?`,
        message: suspended
          ? 'They can sign in and book again.'
          : 'They are signed out everywhere at once and cannot sign in until reactivated. Tows already in progress are not cancelled.',
        confirm: suspended ? 'Reactivate' : 'Suspend',
        danger: !suspended,
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      if (suspended) await reactivateUser(c.userId, reason.trim());
      else await suspendUser(c.userId, reason.trim());
      toast(suspended ? 'Customer reactivated' : 'Customer suspended');
      setOpen(false);
      setReason('');
      onDone();
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>
        {c.fullName ?? <span className="muted">No name yet</span>}
        <div className="muted">
          {c.phone}
          {c.email ? ` · ${c.email}` : ''}
        </div>
      </td>
      <td>
        <Badge status={suspended ? 'suspended' : 'approved'} label={c.status} />
      </td>
      <td>
        {c.completedBookings} completed
        {c.activeBookings > 0 && <div className="muted">{c.activeBookings} in progress</div>}
      </td>
      <td style={{ textAlign: 'right' }}>{aed(c.spentFils)}</td>
      <td>{when(c.createdAt)}</td>
      <td>{when(c.lastBookingAt)}</td>
      <td>
        {open ? (
          <div className="row">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (audit log)"
              aria-label="Reason"
              style={{ minWidth: 160 }}
            />
            <button className={suspended ? '' : 'danger'} disabled={busy || reason.trim().length < 3} onClick={() => void change()}>
              {suspended ? 'Reactivate' : 'Suspend'}
            </button>
            <button onClick={() => setOpen(false)}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => setOpen(true)}>{suspended ? 'Reactivate…' : 'Suspend…'}</button>
        )}
      </td>
    </tr>
  );
}
