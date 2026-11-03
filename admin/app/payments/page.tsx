'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ErrorBox, Shell, useLoad } from '../../components/Shell';
import { Badge, Empty, Kpi, SkeletonRows, useFeedback } from '../../components/ui';
import { aed, errorText, listPayments, paymentsCsv, PaymentRow, refundPayment, when } from '../../lib/admin';

/** Full refund for a captured card / Apple Pay payment; cash is refunded outside the app. */
function RefundCell({ p, onDone }: { p: PaymentRow; onDone: () => void }) {
  const { confirm, toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (p.status === 'refunded') return <span className="muted">Refunded {when(p.refundedAt)}</span>;
  if (p.status !== 'captured' || p.method === 'cash') return null;
  if (!open) return <button onClick={() => setOpen(true)}>Refund…</button>;
  return (
    <div className="row">
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (min 5 chars)" aria-label="Refund reason" />
      <button
        className="danger"
        disabled={busy || reason.trim().length < 5}
        onClick={async () => {
          if (
            !(await confirm({
              title: `Refund ${aed(p.amountFils)} for ${p.bookingNumber}?`,
              message: 'The full amount goes back to the customer’s card through the payment gateway. This cannot be undone.',
              confirm: 'Refund',
              danger: true,
            }))
          ) {
            return;
          }
          setBusy(true);
          try {
            await refundPayment(p.paymentId, reason.trim());
            toast('Refund sent to the payment gateway');
            onDone();
          } catch (e) {
            toast(errorText(e), true);
          } finally {
            setBusy(false);
          }
        }}
      >
        Refund
      </button>
      <button onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}

const METHODS = [
  ['', 'All'],
  ['cash', 'Cash'],
  ['card', 'Card'],
  ['apple_pay', 'Apple Pay'],
] as const;

export default function PaymentsPage() {
  const [method, setMethod] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const filter = { method, from, to };
  const { data, error, reload } = useLoad(() => listPayments(filter, page), [method, from, to, page]);
  const t = data?.totals;
  const { toast } = useFeedback();

  async function exportCsv() {
    setExporting(true);
    try {
      const csv = await paymentsCsv(filter);
      const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `townow-payments${from ? `-from-${from}` : ''}${to ? `-to-${to}` : ''}${method ? `-${method}` : ''}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setExporting(false);
    }
  }
  return (
    <Shell
      title="Payments"
      subtitle="Every payment with its 5% VAT, the driver's earning and TowNow's commission (subtotal − driver earning)."
    >
      {t && (
        <div className="grid" style={{ marginBottom: 14 }}>
          <Kpi label="Collected (captured)" value={aed(t.collectedFils)} />
          <Kpi label="VAT (5%)" value={aed(t.vatFils)} />
          <Kpi label="Driver earnings" value={aed(t.driverEarningsFils)} />
          <Kpi label="TowNow commission" value={aed(t.commissionFils)} />
        </div>
      )}
      <div className="row" style={{ marginBottom: 14 }}>
        <div className="seg">
          {METHODS.map(([value, label]) => (
            <button
              key={value}
              className={method === value ? 'on' : ''}
              onClick={() => {
                setMethod(value);
                setPage(1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="row muted">
          From
          <input type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        </label>
        <label className="row muted">
          To
          <input type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </label>
        {(from || to) && (
          <button onClick={() => { setFrom(''); setTo(''); setPage(1); }}>All dates</button>
        )}
        <button disabled={exporting || !t?.count} onClick={() => void exportCsv()}>
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>
      <p className="muted" style={{ margin: '0 0 14px', fontSize: 12 }}>
        Dates are UAE calendar days, by when the money was collected. Totals and the CSV follow the filters.
      </p>
      <ErrorBox error={error} />
      {!data && !error && <SkeletonRows rows={5} cols={7} />}
      {data?.items.length === 0 && (
        <div className="card">
          <Empty title="No payments yet">Payments appear when a job is paid or its cash is collected.</Empty>
        </div>
      )}
      {!!data?.items.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Customer / driver</th>
                <th>Method</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ textAlign: 'right' }}>VAT</th>
                <th style={{ textAlign: 'right' }}>Driver</th>
                <th style={{ textAlign: 'right' }}>Commission</th>
                <th>Date</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.paymentId}>
                  <td>
                    <Link href={`/bookings/${p.bookingId}`}>{p.bookingNumber}</Link>
                    <div className="muted">{p.bookingStatus.replace(/_/g, ' ')}</div>
                  </td>
                  <td>
                    {p.customerName ?? p.customerPhone}
                    <div className="muted">→ {p.driverName ?? p.driverPhone ?? 'no driver'}</div>
                  </td>
                  <td>{p.method.replace('_', ' ')}</td>
                  <td>
                    <Badge status={p.status} />
                  </td>
                  <td style={{ textAlign: 'right' }}>{aed(p.amountFils)}</td>
                  <td style={{ textAlign: 'right' }}>{p.vatFils == null ? '—' : aed(p.vatFils)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {p.driverEarningFils == null ? '—' : aed(p.driverEarningFils)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {p.commissionFils == null ? '—' : aed(p.commissionFils)}
                  </td>
                  <td>{when(p.capturedAt ?? p.createdAt)}</td>
                  <td>
                    <RefundCell p={p} onDone={reload} />
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
            Page {page} · {t?.count ?? 0} payments
          </span>
          <button disabled={page * data.limit >= (t?.count ?? 0)} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </Shell>
  );
}
