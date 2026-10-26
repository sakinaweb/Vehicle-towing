import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FileText, LogOut, RefreshCw, ShieldAlert, UserCheck, XCircle } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { OtpInput } from '../../components/common/OtpInput';
import { StatusBadge } from '../../components/common/StatusBadge';
import { useToast } from '../../components/common/Toast';
import { ApiError } from '../../services/api';
import {
  approveKyc,
  getKycDocumentFile,
  getKycDriver,
  getKycQueue,
  KycDriver,
  KycQueue,
  rejectKyc,
} from '../../services/adminKyc';
import { DOCUMENT_LABELS, KycStatus } from '../../services/dispatch';
import { useAuth } from '../../services/useAuth';
import { useOtpSignIn } from '../../services/useOtpSignIn';

const STATUS_TABS: { value: KycStatus; label: string }[] = [
  { value: 'pending', label: 'Pending Review' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'approved', label: 'Approved' },
];

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/**
 * Real driver KYC review (admin API). Admins sign in with an SMS code; their
 * accounts are provisioned on the server (npm run admin:create).
 */
export const KycReview: React.FC = () => {
  const { showToast } = useToast();
  const auth = useAuth('admin');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const signIn = useOtpSignIn(auth, {
    onCodeSent: () => setStep('otp'),
    onSignedIn: () => {
      setStep('phone');
      showToast('Signed in to the TowNow console', 'success');
    },
    onNeedPhone: () => setStep('phone'),
    notify: (m, type) => showToast(m, type),
  });

  const [status, setStatus] = useState<KycStatus>('pending');
  const [queue, setQueue] = useState<KycQueue | null>(null);
  const [selected, setSelected] = useState<KycDriver | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const loadQueue = useCallback(async () => {
    try {
      setQueue(await getKycQueue(auth.client, status));
    } catch (err) {
      showToast(errorText(err, 'Could not load the KYC queue.'), 'error');
    }
  }, [auth.client, status]);

  useEffect(() => {
    if (auth.status === 'signedIn') void loadQueue();
  }, [auth.status, loadQueue]);

  const openDriver = async (driverId: string) => {
    try {
      setSelected(await getKycDriver(auth.client, driverId));
      setReason('');
    } catch (err) {
      showToast(errorText(err, 'Could not load this driver.'), 'error');
    }
  };

  const viewDocument = async (documentId: string) => {
    if (!selected) return;
    // Open the tab synchronously (popup blockers), then point it at the authorised download.
    const tab = window.open('', '_blank');
    try {
      const blob = await getKycDocumentFile(auth.client, selected.driverId, documentId);
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      tab?.close();
      showToast(errorText(err, 'Could not open the document.'), 'error');
    }
  };

  const decide = async (decision: 'approve' | 'reject') => {
    if (!selected) return;
    if (decision === 'reject' && reason.trim().length < 5) {
      showToast('Give the driver a reason (at least 5 characters).', 'error');
      return;
    }
    setBusy(true);
    try {
      const updated =
        decision === 'approve'
          ? await approveKyc(auth.client, selected.driverId)
          : await rejectKyc(auth.client, selected.driverId, reason.trim());
      setSelected(updated);
      showToast(decision === 'approve' ? 'KYC approved — driver can go online' : 'KYC rejected — driver notified', 'success');
      await loadQueue();
    } catch (err) {
      showToast(errorText(err, 'Could not save the decision.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const card = 'p-4 rounded-2xl bg-slate-900 border border-slate-800';

  if (auth.status === 'checking') {
    return <div className={`${card} text-xs text-slate-400`}>Checking console session…</div>;
  }

  if (auth.status !== 'signedIn') {
    return (
      <div className={`${card} space-y-3 max-w-md`}>
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-bold text-slate-100">Driver KYC Review — admin sign-in</h3>
        </div>
        {step === 'phone' ? (
          <>
            <label className="block text-xs text-slate-400" htmlFor="admin-phone">
              Admin mobile number
            </label>
            <input
              id="admin-phone"
              aria-label="Admin Mobile"
              value={signIn.phone}
              onChange={(e) => signIn.setPhone(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void signIn.submitPhone()}
              placeholder="50 123 4567"
              inputMode="tel"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500"
            />
            {signIn.phoneError && <p className="text-xs text-rose-400">{signIn.phoneError}</p>}
            <Button variant="primary" size="sm" isLoading={signIn.busy} onClick={() => void signIn.submitPhone()}>
              Send Admin Code
            </Button>
          </>
        ) : (
          <>
            <p className="text-xs text-slate-400">Enter the 6-digit code sent to {signIn.phone}.</p>
            <OtpInput
              value={signIn.otp}
              onChange={signIn.setOtp}
              onSubmit={() => void signIn.verifyOtp()}
              hasError={!!signIn.otpError}
              disabled={signIn.busy}
            />
            {signIn.otpError && <p className="text-xs text-rose-400">{signIn.otpError}</p>}
            <div className="flex gap-2">
              <Button variant="primary" size="sm" isLoading={signIn.busy} onClick={() => void signIn.verifyOtp()}>
                Verify & Sign In
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setStep('phone')}>
                Change number
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`${card} space-y-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <UserCheck className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-bold text-slate-100">Driver KYC Review</h3>
          <span className="text-[11px] text-slate-500">live data</span>
        </div>
        <div className="flex items-center gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => {
                setStatus(tab.value);
                setSelected(null);
              }}
              className={`px-3 py-1 rounded-xl text-xs font-semibold ${
                status === tab.value ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
          <button onClick={() => void loadQueue()} aria-label="Refresh KYC queue" className="p-1.5 text-slate-400 hover:text-white">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => void auth.logout()} aria-label="Sign out of console" className="p-1.5 text-slate-400 hover:text-white">
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Queue */}
        <div className="space-y-2">
          {!queue ? (
            <p className="text-xs text-slate-500">Loading…</p>
          ) : queue.items.length === 0 ? (
            <p className="text-xs text-slate-500 p-4 text-center border border-dashed border-slate-800 rounded-xl">
              No {status} drivers.
            </p>
          ) : (
            queue.items.map((d) => (
              <button
                key={d.driverId}
                onClick={() => void openDriver(d.driverId)}
                className={`w-full text-left p-3 rounded-xl border text-xs transition-colors ${
                  selected?.driverId === d.driverId
                    ? 'border-amber-500/60 bg-slate-950'
                    : 'border-slate-800 bg-slate-950/50 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-100">{d.fullName ?? 'Name not provided'}</span>
                  <StatusBadge status={d.kycStatus} />
                </div>
                <div className="text-slate-400 mt-1 flex justify-between">
                  <span className="font-mono">{d.phone}</span>
                  <span>
                    Docs {d.documentsUploaded}/{d.documentsRequired} · Trucks {d.towTrucks}
                  </span>
                </div>
              </button>
            ))
          )}
          {queue && queue.total > queue.items.length && (
            <p className="text-[11px] text-slate-500">
              Showing {queue.items.length} of {queue.total} (oldest first)
            </p>
          )}
        </div>

        {/* Detail */}
        {selected ? (
          <div className="space-y-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-400">Driver</span>
                <span className="font-bold text-slate-100">{selected.fullName ?? 'Name not provided'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Mobile</span>
                <span className="font-mono text-slate-200">{selected.phone}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">KYC</span>
                <StatusBadge status={selected.kycStatus} />
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Experience · trips</span>
                <span className="text-slate-200">
                  {selected.experienceYears} yrs · {selected.totalTrips} trips
                </span>
              </div>
              {selected.kycRejectionReason && (
                <div className="text-rose-400 pt-1">Last rejection: {selected.kycRejectionReason}</div>
              )}
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
              <div className="font-semibold text-slate-300">Tow trucks</div>
              {selected.towTrucks.length === 0 && <div className="text-slate-500">None registered</div>}
              {selected.towTrucks.map((t) => (
                <div key={t.id} className="flex justify-between text-slate-300">
                  <span>
                    {t.model} ({t.year}) · {t.towType}
                  </span>
                  <span className="font-mono text-amber-400">
                    {t.plateEmirate} {t.plateCode} {t.plateNumber}
                  </span>
                </div>
              ))}
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
              <div className="font-semibold text-slate-300">Documents</div>
              {selected.documents.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between gap-2">
                  <span className="text-slate-300">
                    {DOCUMENT_LABELS[doc.type]}
                    {doc.documentNumber && <span className="text-slate-500"> · {doc.documentNumber}</span>}
                    {doc.expiresOn && <span className="text-slate-500"> · exp {doc.expiresOn}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    {doc.status === 'expired' ? <span className="text-rose-400">Expired</span> : <StatusBadge status={doc.status} />}
                    <button
                      onClick={() => void viewDocument(doc.id)}
                      className="text-amber-400 hover:text-amber-300 flex items-center gap-1"
                    >
                      <FileText className="w-3.5 h-3.5" /> View
                    </button>
                  </span>
                </div>
              ))}
              {selected.missingDocuments.map((type) => (
                <div key={type} className="flex justify-between text-rose-400">
                  <span>{DOCUMENT_LABELS[type]}</span>
                  <span>Not uploaded</span>
                </div>
              ))}
            </div>

            <textarea
              aria-label="Rejection reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason shown to the driver if you reject (e.g. Emirates ID scan is blurry)"
              maxLength={255}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 outline-none focus:border-amber-500 min-h-[60px]"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || selected.kycStatus === 'rejected'}
                onClick={() => void decide('reject')}
                leftIcon={<XCircle className="w-3.5 h-3.5" />}
              >
                Reject KYC
              </Button>
              <Button
                variant="primary"
                size="sm"
                isLoading={busy}
                disabled={selected.kycStatus === 'approved' || selected.missingDocuments.length > 0}
                onClick={() => void decide('approve')}
                leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
              >
                Approve KYC
              </Button>
            </div>
            {selected.missingDocuments.length > 0 && (
              <p className="text-[11px] text-slate-500 text-right">All four documents are needed before approval.</p>
            )}
          </div>
        ) : (
          <div className="text-xs text-slate-500 p-6 text-center border border-dashed border-slate-800 rounded-xl">
            Select a driver to review their details and documents.
          </div>
        )}
      </div>
    </div>
  );
};
