import React from 'react';
import {
  LayoutDashboard,
  Radio,
  CalendarCheck,
  Truck,
  Users,
  BadgePercent,
  MapPin,
  Wallet,
  Headphones,
  BarChart3,
  UserCheck,
  ShieldAlert,
  Settings,
  ChevronRight,
} from 'lucide-react';

export type AdminSection =
  | 'dashboard'
  | 'live_operations'
  | 'bookings'
  | 'partners'
  | 'customers'
  | 'pricing'
  | 'service_areas'
  | 'finance'
  | 'support'
  | 'reports'
  | 'staff'
  | 'audit_logs'
  | 'settings';

export interface AdminSidebarProps {
  currentSection: AdminSection;
  onSelectSection: (section: AdminSection) => void;
  collapsed?: boolean;
}

export const AdminSidebar: React.FC<AdminSidebarProps> = ({
  currentSection,
  onSelectSection,
  collapsed = false,
}) => {
  const menuItems = [
    { id: 'dashboard' as AdminSection, label: 'Dashboard', icon: LayoutDashboard },
    {
      id: 'live_operations' as AdminSection,
      label: 'Live Operations',
      icon: Radio,
    },
    { id: 'bookings' as AdminSection, label: 'Bookings', icon: CalendarCheck },
    { id: 'partners' as AdminSection, label: 'Partners & KYC', icon: Truck },
    { id: 'customers' as AdminSection, label: 'Customers', icon: Users },
    { id: 'pricing' as AdminSection, label: 'Pricing Engine', icon: BadgePercent },
    { id: 'service_areas' as AdminSection, label: 'Service Areas', icon: MapPin },
    { id: 'finance' as AdminSection, label: 'Finance & VAT', icon: Wallet },
    { id: 'support' as AdminSection, label: 'Support & SOS', icon: Headphones },
    { id: 'reports' as AdminSection, label: 'Reports & BI', icon: BarChart3 },
    { id: 'staff' as AdminSection, label: 'Staff & Roles', icon: UserCheck },
    { id: 'audit_logs' as AdminSection, label: 'Audit Logs', icon: ShieldAlert },
    { id: 'settings' as AdminSection, label: 'Settings', icon: Settings },
  ];

  return (
    <aside
      className={`h-screen sticky top-0 bg-[#090d16] border-r border-slate-800/80 flex flex-col z-30 transition-all ${
        collapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Brand Header */}
      <div className="h-16 px-5 flex items-center justify-between border-b border-slate-800/80 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-amber-500 flex items-center justify-center text-slate-950 font-black shadow-md shadow-amber-500/20">
            TN
          </div>
          {!collapsed && (
            <div>
              <div className="font-bold text-sm text-slate-100 tracking-tight flex items-center gap-1.5">
                <span>TowNow</span>
                <span className="text-[10px] bg-slate-800 text-amber-400 font-medium px-1.5 py-0.2 rounded border border-slate-700">
                  OPS
                </span>
              </div>
              <div className="text-[10px] text-slate-400">UAE Fleet HQ</div>
            </div>
          )}
        </div>
      </div>

      {/* Navigation List */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentSection === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onSelectSection(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all group ${
                isActive
                  ? 'bg-amber-500/10 text-amber-400 font-semibold border border-amber-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850/60'
              }`}
              title={item.label}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Icon
                  className={`w-4 h-4 shrink-0 transition-colors ${
                    isActive ? 'text-amber-400' : 'text-slate-400 group-hover:text-slate-200'
                  }`}
                />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </div>
            </button>
          );
        })}
      </div>

      {/* UAE Region */}
      {!collapsed && (
        <div className="p-4 border-t border-slate-800/80 bg-slate-950/40">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Jurisdiction</span>
            <span className="font-semibold text-slate-200">Dubai & Abu Dhabi</span>
          </div>
        </div>
      )}
    </aside>
  );
};
