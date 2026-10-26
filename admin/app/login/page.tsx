'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '../../components/ui';
import { errorText, requestOtp, verifyOtp } from '../../lib/admin';

/** Admins are provisioned (npm run admin:create); other numbers are refused by the API. */
export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = (fn: () => Promise<void>) => async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  /** 050 123 4567 / +971 50… → +97150… (the API validates it). */
  const normalized = () => {
    let d = phone.replace(/\D/g, '');
    if (d.startsWith('00971')) d = d.slice(5);
    if (d.startsWith('971')) d = d.slice(3);
    if (d.startsWith('0')) d = d.slice(1);
    return `+971${d}`;
  };

  return (
    <div className="auth">
      <section className="auth-hero">
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark">
            <Icon name="truck" size={18} />
          </span>
          <div>
            TowNow
            <small>Operations</small>
          </div>
        </div>
        <div>
          <h2>Run every tow from one place.</h2>
          <p>Live jobs, driver verification, commission settlement, disputes and fares.</p>
        </div>
        <p style={{ fontSize: 13 }}>Access is limited to provisioned TowNow staff.</p>
      </section>
      <section className="auth-form">
        {sent === null ? (
          <form
            className="login"
            onSubmit={run(async () => {
              const p = normalized();
              await requestOtp(p);
              setSent(p);
            })}
          >
            <h1>Sign in</h1>
            <p className="subtitle" style={{ marginTop: 0 }}>
              We&apos;ll send a code to your registered mobile.
            </p>
            <label className="field" htmlFor="phone">
              Admin mobile number
              <input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="050 123 4567"
                autoComplete="tel"
              />
            </label>
            <button disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
            {error && <div className="error">{error}</div>}
          </form>
        ) : (
          <form
            className="login"
            onSubmit={run(async () => {
              await verifyOtp(sent, code.trim());
              router.replace('/');
            })}
          >
            <h1>Enter code</h1>
            <p className="subtitle" style={{ marginTop: 0 }}>
              Sent to {sent}
            </p>
            <input
              id="code"
              aria-label="Verification code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              style={{ fontSize: 24, letterSpacing: 10, textAlign: 'center', fontWeight: 800 }}
            />
            <button disabled={busy || code.trim().length !== 6}>{busy ? 'Checking…' : 'Sign in'}</button>
            <button type="button" className="secondary" onClick={() => setSent(null)}>
              Use a different number
            </button>
            {error && <div className="error">{error}</div>}
          </form>
        )}
      </section>
    </div>
  );
}
