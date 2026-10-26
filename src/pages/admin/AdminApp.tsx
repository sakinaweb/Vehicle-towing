import React, { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { AdminSidebar, AdminSection } from '../../components/navigation/AdminSidebar';
import { AdminHeader } from '../../components/navigation/AdminHeader';
import { KycReview } from './KycReview';

/**
 * Admin persona of the web demo. Only real data is shown: driver KYC review runs against the
 * API here; everything else lives in the TowNow Admin Panel (admin/, Next.js) or is not built yet.
 * No sample records are displayed as if they were real.
 */
const ADMIN_PANEL_URL =
  (import.meta.env.VITE_ADMIN_URL as string | undefined) || 'http://localhost:3001';

/** Sections with a live, API-backed screen in the Admin Panel. */
const IN_ADMIN_PANEL: Partial<Record<AdminSection, { path: string; screen: string }>> = {
  dashboard: { path: '/', screen: 'Overview' },
  live_operations: { path: '/', screen: 'Overview (active tows)' },
  bookings: { path: '/bookings', screen: 'Bookings' },
  partners: { path: '/drivers', screen: 'Drivers' },
  pricing: { path: '/pricing', screen: 'Pricing' },
  finance: { path: '/commissions', screen: 'Commissions' },
  support: { path: '/disputes', screen: 'Disputes' },
};

export interface AdminAppProps {
  initialSection?: AdminSection;
  onSectionChange?: (section: AdminSection) => void;
}

export const AdminApp: React.FC<AdminAppProps> = ({
  initialSection = 'dashboard',
  onSectionChange,
}) => {
  const [currentSection, setCurrentSection] = useState<AdminSection>(initialSection);

  React.useEffect(() => {
    if (initialSection && initialSection !== currentSection) {
      setCurrentSection(initialSection);
    }
  }, [initialSection]);

  const handleSelectSection = (sec: AdminSection) => {
    setCurrentSection(sec);
    onSectionChange?.(sec);
  };

  const panel = IN_ADMIN_PANEL[currentSection];

  return (
    <div className="min-h-screen bg-[#070b13] text-slate-100 flex flex-col md:flex-row">
      <AdminSidebar currentSection={currentSection} onSelectSection={handleSelectSection} />

      <div className="flex-1 flex flex-col min-w-0">
        <AdminHeader currentSection={currentSection} />

        <main className="flex-1 p-6 overflow-y-auto space-y-4">
          {currentSection === 'partners' && <KycReview />}

          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 text-xs text-slate-300 max-w-2xl">
            {panel ? (
              <>
                <p>
                  Live {panel.screen.toLowerCase()} data from the TowNow database is in the{' '}
                  <span className="font-semibold text-white">TowNow Admin Panel</span>.
                </p>
                <a
                  href={`${ADMIN_PANEL_URL}${panel.path}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500 text-slate-950 font-semibold"
                >
                  Open {panel.screen} <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </>
            ) : (
              <p>
                <span className="font-semibold text-white">Not built yet.</span> There is no admin
                API or screen for this section, so nothing is shown here.
              </p>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
