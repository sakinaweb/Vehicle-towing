import React from 'react';
import {
  Smartphone,
  Truck,
  ShieldCheck,
  Monitor,
  Maximize2,
  ChevronDown,
} from 'lucide-react';

export type AppPersona = 'customer' | 'driver' | 'admin';

export interface AppSwitcherProps {
  currentPersona: AppPersona;
  onChangePersona: (persona: AppPersona) => void;
  // Specific screen jumpers
  customerScreen: string;
  onChangeCustomerScreen: (screen: string) => void;
  driverScreen: string;
  onChangeDriverScreen: (screen: string) => void;
  adminSection: string;
  onChangeAdminSection: (section: string) => void;
}

export const CUSTOMER_SCREENS = [
  { id: 'home', label: '05. Home Dashboard' },
  { id: 'request_tow', label: '06. Request Tow (Form)' },
  { id: 'vehicle_select', label: '07. Vehicle Selection' },
  { id: 'location_select', label: '08. Location / Map Pin' },
  { id: 'fare_estimate', label: '09. Fare Estimate & VAT' },
  { id: 'payment', label: '10. Payment Selection' },
  { id: 'card_payment', label: '10b. Card Payment (Stripe)' },
  { id: 'searching', label: '11. Searching for Driver' },
  { id: 'driver_found', label: '12. Driver Found Profile' },
  { id: 'live_tracking', label: '13. Live Map Tracking' },
  { id: 'trip_status', label: '14. Trip Status Steps' },
  { id: 'completion', label: '15. Trip Completed & Invoice' },
  { id: 'rating', label: '16. Driver Rating & Feedback' },
  { id: 'orders', label: '17. My Orders List' },
  { id: 'order_details', label: '18. Order Details' },
  { id: 'notifications', label: '19. Notifications Inbox' },
  { id: 'disputes', label: '19b. My Disputes' },
  { id: 'profile', label: '20. Customer Profile' },
  { id: 'chat', label: '21. Chat with Driver' },
  { id: 'driver_profile', label: '22. Driver Profile' },
  { id: 'splash', label: '01. Splash Screen' },
  { id: 'welcome', label: '02. Welcome / Onboarding' },
  { id: 'login', label: '03. Login (+971 UAE)' },
  { id: 'otp', label: '04. OTP 6-Digit Screen' },
];

export const DRIVER_SCREENS = [
  { id: 'driver_home', label: '09. Partner Home Dashboard' },
  { id: 'online_toggle', label: '10. Online / Offline Toggle' },
  { id: 'incoming_job', label: '11. Incoming Job Radar' },
  { id: 'job_details', label: '12. Job Details & Vehicle' },
  { id: 'accept_job', label: '13. Accept Job / Dispatch' },
  { id: 'navigation', label: '14. Turn-by-Turn Navigation' },
  { id: 'arrived', label: '15. Arrived at Customer' },
  { id: 'vehicle_inspection', label: '16. Pre-Load Inspection' },
  { id: 'vehicle_loaded', label: '17. Vehicle Loaded & Secured' },
  { id: 'in_transit', label: '18. In Transit to Garage' },
  { id: 'complete_job', label: '19. Complete Job Unload' },
  { id: 'cash_collection', label: '20. Cash & Digital Payment' },
  { id: 'earnings', label: '21. Earnings Summary' },
  { id: 'earnings_details', label: '22. Payout Breakdown' },
  { id: 'job_history', label: '23. Tow History' },
  { id: 'ratings', label: '24. Driver Ratings & Reviews' },
  { id: 'notifications', label: '25. Notifications' },
  { id: 'profile', label: '26. Partner Profile' },
  { id: 'documents', label: '27. Uploaded Documents' },
  { id: 'support', label: '28. Roadside Partner Support' },
  { id: 'login', label: '01. Driver Login' },
  { id: 'otp', label: '02. Driver OTP' },
  { id: 'kyc_intro', label: '03. KYC Introduction' },
  { id: 'emirates_id', label: '04. Emirates ID Scan' },
  { id: 'driving_licence', label: '05. Heavy Driving License' },
  { id: 'vehicle_reg', label: '06. Mulkiya Registration' },
  { id: 'insurance', label: '07. Commercial Insurance' },
  { id: 'kyc_status', label: '08. Verification Approval' },
];

export const ADMIN_SECTIONS = [
  { id: 'dashboard', label: 'Executive Dashboard' },
  { id: 'live_operations', label: 'Live Fleet Operations' },
  { id: 'bookings', label: 'Bookings Management' },
  { id: 'partners', label: 'Towing Partners & KYC' },
  { id: 'customers', label: 'Customer Directory' },
  { id: 'pricing', label: 'Pricing Engine & VAT' },
  { id: 'service_areas', label: 'Dubai & Abu Dhabi Zones' },
  { id: 'finance', label: 'Finance & Partner Payouts' },
  { id: 'support', label: 'Support & Emergency SOS' },
  { id: 'reports', label: 'Analytics & BI Reports' },
  { id: 'staff', label: 'Staff Roles & Permissions' },
  { id: 'audit_logs', label: 'Security & Audit Logs' },
  { id: 'settings', label: 'Platform Settings' },
];

export const AppSwitcher: React.FC<AppSwitcherProps> = ({
  currentPersona,
  onChangePersona,
  customerScreen,
  onChangeCustomerScreen,
  driverScreen,
  onChangeDriverScreen,
  adminSection,
  onChangeAdminSection,
}) => {
  return (
    <div className="bg-canvas border-b border-line px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs select-none sticky top-0 z-50">
      {/* Brand & Persona Tabs */}
      <div className="flex items-center gap-3">
        {/* Brand Chip */}
        <div className="flex items-center gap-2 pr-3 border-r border-line">
          <div className="w-6 h-6 rounded-lg bg-lime text-navy font-black flex items-center justify-center text-xs shadow-xs">
            TN
          </div>
          <span className="font-bold text-ink tracking-tight text-sm">TowNow</span>
          <span className="text-[10px] text-navy bg-lime/20 px-1.5 py-0.2 rounded font-semibold border border-navy/20">
            UAE UI
          </span>
        </div>

        {/* Persona Switcher Buttons */}
        <div className="flex items-center gap-1 bg-surface p-1 rounded-xl border border-line">
          <button
            onClick={() => onChangePersona('customer')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
              currentPersona === 'customer'
                ? 'bg-lime text-navy font-bold shadow-xs'
                : 'text-muted hover:text-ink'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Customer App</span>
          </button>

          <button
            onClick={() => onChangePersona('driver')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
              currentPersona === 'driver'
                ? 'bg-lime text-navy font-bold shadow-xs'
                : 'text-muted hover:text-ink'
            }`}
          >
            <Truck className="w-3.5 h-3.5" />
            <span>Driver App</span>
          </button>

          <button
            onClick={() => onChangePersona('admin')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
              currentPersona === 'admin'
                ? 'bg-lime text-navy font-bold shadow-xs'
                : 'text-muted hover:text-ink'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Admin Ops</span>
          </button>
        </div>
      </div>

      {/* Screen Quick Jumper for Easy Review of all 20+ screens */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-muted hidden sm:inline text-[11px]">Screen:</span>
          {currentPersona === 'customer' && (
            <div className="relative">
              <select
                value={customerScreen}
                onChange={(e) => onChangeCustomerScreen(e.target.value)}
                className="appearance-none bg-surface border border-line text-navy text-xs rounded-xl py-1.5 pl-3 pr-8 font-medium focus:outline-none focus:border-navy"
              >
                {CUSTOMER_SCREENS.map((s) => (
                  <option key={s.id} value={s.id} className="bg-surface text-ink">
                    {s.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-muted absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          )}

          {currentPersona === 'driver' && (
            <div className="relative">
              <select
                value={driverScreen}
                onChange={(e) => onChangeDriverScreen(e.target.value)}
                className="appearance-none bg-surface border border-line text-navy text-xs rounded-xl py-1.5 pl-3 pr-8 font-medium focus:outline-none focus:border-navy"
              >
                {DRIVER_SCREENS.map((s) => (
                  <option key={s.id} value={s.id} className="bg-surface text-ink">
                    {s.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-muted absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          )}

          {currentPersona === 'admin' && (
            <div className="relative">
              <select
                value={adminSection}
                onChange={(e) => onChangeAdminSection(e.target.value)}
                className="appearance-none bg-surface border border-line text-navy text-xs rounded-xl py-1.5 pl-3 pr-8 font-medium focus:outline-none focus:border-navy"
              >
                {ADMIN_SECTIONS.map((s) => (
                  <option key={s.id} value={s.id} className="bg-surface text-ink">
                    {s.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-muted absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
