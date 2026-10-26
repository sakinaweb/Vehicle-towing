import React from 'react';
import { ChevronRight } from 'lucide-react';
import { AdminSection } from './AdminSidebar';

export interface AdminHeaderProps {
  currentSection: AdminSection;
}

export const AdminHeader: React.FC<AdminHeaderProps> = ({ currentSection }) => {
  const getSectionTitle = (sec: AdminSection) => {
    return sec
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  };

  return (
    <header className="h-16 px-6 bg-[#090d16] border-b border-slate-800/80 flex items-center justify-between gap-4 sticky top-0 z-20">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-400 font-medium">TowNow HQ</span>
        <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
        <span className="text-amber-400 font-semibold">{getSectionTitle(currentSection)}</span>
      </div>
    </header>
  );
};
