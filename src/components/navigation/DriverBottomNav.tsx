import React from 'react';
import { Home, Compass, DollarSign, User } from 'lucide-react';

export type DriverNavTab = 'home' | 'jobs' | 'earnings' | 'profile';

export interface DriverBottomNavProps {
  activeTab: DriverNavTab;
  onChangeTab: (tab: DriverNavTab) => void;
  hasActiveJob?: boolean;
}

export const DriverBottomNav: React.FC<DriverBottomNavProps> = ({
  activeTab,
  onChangeTab,
  hasActiveJob = false,
}) => {
  const tabs = [
    { id: 'home' as DriverNavTab, label: 'Partner Home', icon: Home },
    {
      id: 'jobs' as DriverNavTab,
      label: 'Jobs',
      icon: Compass,
      hasPulse: hasActiveJob,
    },
    { id: 'earnings' as DriverNavTab, label: 'Earnings', icon: DollarSign },
    { id: 'profile' as DriverNavTab, label: 'Partner ID', icon: User },
  ];

  return (
    <div className="sticky bottom-0 left-0 right-0 z-40 bg-surface/95 backdrop-blur-md border-t border-line px-4 py-2 flex items-center justify-around select-none">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChangeTab(tab.id)}
            className={`flex flex-col items-center justify-center py-1 px-3 min-w-[56px] min-h-[44px] transition-colors relative ${
              isActive ? 'text-navy' : 'text-muted hover:text-ink'
            }`}
          >
            <div className="relative">
              <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5]' : 'stroke-[1.8]'}`} />
              {tab.hasPulse && (
                <span className="absolute -top-0.5 -right-1 w-2.5 h-2.5 rounded-full bg-success ring-2 ring-surface animate-pulse" />
              )}
            </div>
            <span
              className={`text-[10px] mt-1 tracking-tight ${
                isActive ? 'font-bold' : 'font-medium'
              }`}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
};
