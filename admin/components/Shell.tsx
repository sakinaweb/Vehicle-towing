'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, signOut } from '../lib/admin';
import { Icon } from './ui';

/** Who is signed in, kept across client-side navigations. */
let signedInName: string | null = null;

const LINKS = [
  ['/', 'Overview', 'overview'],
  ['/bookings', 'Jobs', 'jobs'],
  ['/drivers', 'Drivers & KYC', 'drivers'],
  ['/commissions', 'Commissions', 'money'],
  ['/disputes', 'Disputes', 'disputes'],
  ['/pricing', 'Fares', 'fares'],
] as const;

export interface Crumb {
  href?: string;
  label: string;
}

/**
 * Signed-in console frame: sidebar, top bar (breadcrumbs + job search), page header.
 * The session is restored from the HttpOnly refresh cookie.
 */
export function Shell({
  title,
  subtitle,
  crumbs,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  crumbs?: Crumb[];
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const path = usePathname();
  const [ready, setReady] = useState(false);
  const [name, setName] = useState<string | null>(signedInName);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (api.getAccessToken()) {
      setReady(true);
      return;
    }
    api
      .refresh()
      .then((s) => {
        if (!s) return router.replace('/login');
        signedInName = s.user.fullName ?? s.user.phone;
        setName(signedInName);
        setReady(true);
      })
      .catch(() => router.replace('/login'));
  }, [router]);

  if (!ready) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }} className="muted">
        Loading…
      </div>
    );
  }
  const section = LINKS.find(([href]) => (href === '/' ? path === '/' : path.startsWith(href)));
  const trail: Crumb[] = crumbs ?? [{ label: section?.[1] ?? title }];
  const initials = (name ?? 'Ops')
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="layout">
        <nav className="sidebar" aria-label="Main">
          <div className="brand">
            <span className="brand-mark">
              <Icon name="truck" size={18} />
            </span>
            <div>
              TowNow
              <small>Operations</small>
            </div>
          </div>
          {LINKS.map(([href, label, icon]) => (
            <Link
              key={href}
              href={href}
              className={`nav-link${section?.[0] === href ? ' active' : ''}`}
            >
              <Icon name={icon} />
              <span>{label}</span>
            </Link>
          ))}
          <div className="spacer" />
          <button
            className="signout"
            onClick={() => void signOut().then(() => router.replace('/login'))}
          >
            <Icon name="logout" size={18} />
            <span>Sign out</span>
          </button>
        </nav>
        <div className="content">
          <header className="topbar">
            <div className="crumbs">
              <Link href="/">Ops</Link>
              {trail.map((c, i) => (
                <span key={i} className="row" style={{ gap: 8 }}>
                  <Icon name="chevron" size={16} />
                  {c.href && i < trail.length - 1 ? (
                    <Link href={c.href}>{c.label}</Link>
                  ) : (
                    <span className="current">{c.label}</span>
                  )}
                </span>
              ))}
            </div>
            <form
              className="search"
              onSubmit={(e) => {
                e.preventDefault();
                router.push(`/bookings?status=all&q=${encodeURIComponent(q.trim())}`);
              }}
            >
              <Icon name="search" size={18} />
              <input
                aria-label="Search jobs"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search booking no. or phone"
              />
            </form>
            <div className="user-chip">
              <span className="avatar">{initials}</span>
              <span>{name ?? 'Operations'}</span>
            </div>
          </header>
          <main>
            <div className="page-head">
              <div>
                <h1>{title}</h1>
                {subtitle && <p className="subtitle">{subtitle}</p>}
              </div>
              {actions}
            </div>
            {children}
          </main>
        </div>
    </div>
  );
}

/** Loads data on mount (and when deps change or reload() is called). */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    load()
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : 'Failed to load.');
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);
  return { data, error, reload: () => setVersion((v) => v + 1) };
}

export function ErrorBox({ error }: { error: string | null }) {
  return error ? <div className="error">{error}</div> : null;
}
