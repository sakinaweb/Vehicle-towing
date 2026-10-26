'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';

// ---------------------------------------------------------------- icons (inline, no icon library)

const PATHS: Record<string, string> = {
  overview: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  jobs: 'M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9 1.96 2.5H17V9.5h2.5zM18 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
  drivers: 'M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z',
  money: 'M21 18v1c0 1.1-.9 2-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14c1.1 0 2 .9 2 2v1h-9a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
  disputes: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 12h-2v-2h2v2zm0-4h-2V6h2v4z',
  fares: 'M21.41 11.58 12.41 2.58A2 2 0 0 0 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58s1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41s-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  truck: 'M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm.5 11H7v-2h4V6h1.5v7z',
  wifi: 'M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8 3 3 3-3a4.24 4.24 0 0 0-6 0zm-4-4 2 2a7.07 7.07 0 0 1 10 0l2-2C15.14 9.14 8.87 9.14 5 13z',
  alert: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
  logout: 'M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z',
  chevron: 'M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
};

export function Icon({ name, size = 20 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.overview} />
    </svg>
  );
}

// ---------------------------------------------------------------- status

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'lime';
const TONES: Record<string, [Tone, string]> = {
  requested: ['info', 'Requested'],
  searching: ['info', 'Searching'],
  driver_assigned: ['lime', 'Assigned'],
  driver_arriving: ['lime', 'On the way'],
  driver_arrived: ['lime', 'Arrived'],
  vehicle_loaded: ['lime', 'Loaded'],
  in_transit: ['lime', 'Towing'],
  completed: ['success', 'Completed'],
  cancelled: ['danger', 'Cancelled'],
  approved: ['success', 'Approved'],
  pending: ['warning', 'Pending'],
  rejected: ['danger', 'Rejected'],
  suspended: ['danger', 'Suspended'],
  open: ['warning', 'Open'],
  resolved: ['success', 'Resolved'],
  online: ['success', 'Online'],
  busy: ['lime', 'On a job'],
  en_route: ['lime', 'On a job'],
  offline: ['neutral', 'Offline'],
  captured: ['success', 'Paid'],
  expired: ['danger', 'Expired'],
};

export function Badge({ status, label }: { status: string; label?: string }) {
  const [tone, text] = TONES[status] ?? ['neutral', status.replace(/_/g, ' ')];
  return <span className={`badge tone-${tone}`}>{label ?? text}</span>;
}

// ---------------------------------------------------------------- blocks

export function Kpi({
  label,
  value,
  hint,
  icon,
  dark,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: string;
  dark?: boolean;
}) {
  return (
    <div className={`card kpi${dark ? ' dark' : ''}`}>
      <div className="label" style={dark ? { color: 'rgba(255,255,255,.7)' } : undefined}>
        {icon && (
          <span className="icon" style={dark ? { background: 'var(--lime)' } : undefined}>
            <Icon name={icon} size={18} />
          </span>
        )}
        {label}
      </div>
      <div className="value" style={dark ? { color: 'var(--lime)' } : undefined}>
        {value}
      </div>
      {hint && (
        <div className="hint" style={dark ? { color: 'rgba(255,255,255,.6)' } : undefined}>
          {hint}
        </div>
      )}
    </div>
  );
}

export function SkeletonRows({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="table-wrap">
      <table>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }, (_, c) => (
                <td key={c}>
                  <div className="skeleton" style={{ height: 14, width: `${50 + ((r * 7 + c * 13) % 45)}%` }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- confirm + toast

interface ConfirmOptions {
  title: string;
  message: string;
  confirm: string;
  danger?: boolean;
}

interface Feedback {
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  toast: (message: string, bad?: boolean) => void;
}

const FeedbackContext = createContext<Feedback | null>(null);

/** App-wide confirmation dialog (native <dialog>) and toast. */
export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [toastMsg, setToastMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o);
    queueMicrotask(() => dialog.current?.showModal());
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (v: boolean) => {
    dialog.current?.close();
    resolver.current?.(v);
    resolver.current = null;
  };

  const toast = useCallback((text: string, bad = false) => {
    setToastMsg({ text, bad });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastMsg(null), 3200);
  }, []);

  return (
    <FeedbackContext.Provider value={{ confirm, toast }}>
      {children}
      <dialog ref={dialog} className="confirm" onCancel={() => close(false)}>
        {opts && (
          <>
            <h3>{opts.title}</h3>
            <p>{opts.message}</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="secondary" onClick={() => close(false)}>
                Not now
              </button>
              <button className={opts.danger ? 'danger' : 'dark'} onClick={() => close(true)}>
                {opts.confirm}
              </button>
            </div>
          </>
        )}
      </dialog>
      {toastMsg && (
        <div className={`toast${toastMsg.bad ? ' bad' : ''}`} role="status">
          {toastMsg.text}
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): Feedback {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('FeedbackProvider missing');
  return ctx;
}
