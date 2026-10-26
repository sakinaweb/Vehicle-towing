'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ErrorBox, Shell, useLoad } from '../../../components/Shell';
import { Badge, Empty, Kpi, SkeletonRows, useFeedback } from '../../../components/ui';
import {
  aed,
  api,
  approveKyc,
  errorText,
  getKycDocumentFile,
  getKycDriver,
  getLedger,
  recordSettlement,
  rejectKyc,
  when,
} from '../../../lib/admin';
import { DOCUMENT_LABELS } from '@shared/services/dispatch';

const ENTRY_LABELS: Record<string, string> = {
  trip_earning: 'Trip earning (after commission)',
  cash_collected: 'Cash collected from customer',
  remittance: 'Remittance received',
  payout: 'Payout sent',
};

export default function DriverPage() {
  const { id } = useParams<{ id: string }>();
  const driver = useLoad(() => getKycDriver(api, id), [id]);
  const ledger = useLoad(() => getLedger(id), [id]);
  const { confirm, toast } = useFeedback();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [settle, setSettle] = useState({
    direction: 'remittance' as 'remittance' | 'payout',
    amount: '',
    reference: '',
  });

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast(done);
      driver.reload();
      ledger.reload();
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(false);
    }
  };

  /** Documents are private: fetched with the admin token, opened as a blob URL. */
  const openDocument = async (documentId: string) => {
    const tab = window.open('', '_blank');
    try {
      const blob = await getKycDocumentFile(api, id, documentId);
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      tab?.close();
      toast(errorText(e), true);
    }
  };

  const d = driver.data;
  const l = ledger.data;
  return (
    <Shell
      title={d ? (d.fullName ?? d.phone) : 'Driver'}
      subtitle={d ? `${d.phone} · registered ${when(d.registeredAt)}` : undefined}
      crumbs={[{ href: '/drivers', label: 'Drivers & KYC' }, { label: d?.fullName ?? '…' }]}
      actions={d && <Badge status={d.kycStatus} />}
    >
      <ErrorBox error={driver.error ?? ledger.error} />
      {!d && !driver.error && <SkeletonRows rows={3} cols={4} />}
      {d && (
        <>
          <div className="grid">
            <Kpi dark icon="drivers" label="KYC" value={<Badge status={d.kycStatus} />} hint={d.kycRejectionReason ?? undefined} />
            <Kpi icon="wifi" label="Availability" value={<Badge status={d.availability} />} />
            <Kpi icon="jobs" label="Trips" value={d.totalTrips} hint={`${d.experienceYears} years experience`} />
            {l && (
              <Kpi
                icon="money"
                label="Settlement"
                value={aed(Math.abs(l.balanceFils))}
                hint={l.balanceFils < 0 ? 'Driver owes TowNow' : l.balanceFils > 0 ? 'TowNow owes driver' : 'Settled'}
              />
            )}
          </div>

          <div className="grid-2" style={{ marginTop: 28 }}>
            <div>
              <h2 style={{ marginTop: 0 }}>Documents</h2>
              <div className="table-wrap">
                <table>
                  <tbody>
                    {d.documents.map((doc) => (
                      <tr key={doc.id}>
                        <td>
                          <strong>{DOCUMENT_LABELS[doc.type]}</strong>
                          <span className="sub">{doc.documentNumber ?? 'No number given'}</span>
                        </td>
                        <td>
                          <Badge status={doc.status} />
                        </td>
                        <td className="muted">{when(doc.uploadedAt)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="secondary" onClick={() => void openDocument(doc.id)}>
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                    {d.missingDocuments.map((t) => (
                      <tr key={t}>
                        <td>
                          <strong>{DOCUMENT_LABELS[t]}</strong>
                        </td>
                        <td colSpan={3}>
                          <Badge status="rejected" label="Missing" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h2>Tow trucks</h2>
              <div className="card">
                {d.towTrucks.length === 0 && <span className="danger-text">No truck registered.</span>}
                {d.towTrucks.map((t) => (
                  <div key={t.id} className="row" style={{ justifyContent: 'space-between', padding: '4px 0' }}>
                    <span>
                      <strong>{t.model}</strong> ({t.year}) · {t.towType}
                    </span>
                    <span className="badge tone-neutral">
                      {t.plateEmirate} {t.plateCode} {t.plateNumber}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h2 style={{ marginTop: 0 }}>KYC decision</h2>
              <div className="card" style={{ display: 'grid', gap: 10 }}>
                {d.missingDocuments.length > 0 && (
                  <div className="notice">{d.missingDocuments.length} required document(s) missing.</div>
                )}
                <button
                  disabled={busy || d.missingDocuments.length > 0 || d.kycStatus === 'approved'}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: 'Approve this driver?',
                        message: 'They will be able to go online and receive tow requests.',
                        confirm: 'Approve',
                      })
                    ) {
                      await act(() => approveKyc(api, id), 'Driver approved');
                    }
                  }}
                >
                  Approve driver
                </button>
                <label className="field">
                  Rejection reason (shown to the driver)
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Emirates ID photo is blurry" />
                </label>
                <button
                  className="danger"
                  disabled={busy || reason.trim().length < 5}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: 'Reject this driver?',
                        message: 'They will be taken offline and asked to fix their documents.',
                        confirm: 'Reject',
                        danger: true,
                      })
                    ) {
                      await act(() => rejectKyc(api, id, reason.trim()), 'Driver rejected');
                      setReason('');
                    }
                  }}
                >
                  Reject
                </button>
              </div>

              {l && (
                <>
                  <h2>Record a settlement</h2>
                  <form
                    className="card"
                    style={{ display: 'grid', gap: 10 }}
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const amountFils = Math.round(Number(settle.amount) * 100);
                      if (
                        !(await confirm({
                          title: `Record ${aed(amountFils)}?`,
                          message: `${settle.direction === 'remittance' ? 'Driver paid TowNow' : 'TowNow paid the driver'} · reference ${settle.reference.trim()}. Each reference can be used once.`,
                          confirm: 'Record',
                        }))
                      ) {
                        return;
                      }
                      await act(async () => {
                        await recordSettlement(id, {
                          direction: settle.direction,
                          amountFils,
                          reference: settle.reference.trim(),
                        });
                        setSettle({ ...settle, amount: '', reference: '' });
                      }, 'Settlement recorded');
                    }}
                  >
                    <div className="seg">
                      <button type="button" className={settle.direction === 'remittance' ? 'on' : ''} onClick={() => setSettle({ ...settle, direction: 'remittance' })}>
                        Driver paid TowNow
                      </button>
                      <button type="button" className={settle.direction === 'payout' ? 'on' : ''} onClick={() => setSettle({ ...settle, direction: 'payout' })}>
                        TowNow paid driver
                      </button>
                    </div>
                    <label className="field">
                      Amount (AED)
                      <input inputMode="decimal" value={settle.amount} onChange={(e) => setSettle({ ...settle, amount: e.target.value })} placeholder={l.balanceFils < 0 ? (-l.balanceFils / 100).toFixed(2) : '0.00'} />
                    </label>
                    <label className="field">
                      Bank / receipt reference
                      <input value={settle.reference} onChange={(e) => setSettle({ ...settle, reference: e.target.value })} placeholder="e.g. FT-2026-10-11-0001" />
                    </label>
                    <button className="dark" disabled={busy || !(Number(settle.amount) > 0) || settle.reference.trim().length < 3}>
                      Record settlement
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>

          <h2>Ledger</h2>
          {!l ? (
            <SkeletonRows rows={3} cols={4} />
          ) : l.entries.length === 0 ? (
            <div className="card">
              <Empty title="No ledger entries yet">Completed jobs and settlements appear here.</Empty>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Entry</th>
                    <th>Reference</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {l.entries.map((e) => (
                    <tr key={e.id}>
                      <td className="muted">{when(e.createdAt)}</td>
                      <td>{ENTRY_LABELS[e.type] ?? e.type}</td>
                      <td className="muted">{e.reference ?? ''}</td>
                      <td className={`num ${e.amountFils < 0 ? 'danger-text' : 'ok'}`} style={{ textAlign: 'right', fontWeight: 800 }}>
                        {e.amountFils < 0 ? '−' : '+'}
                        {aed(Math.abs(e.amountFils))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
