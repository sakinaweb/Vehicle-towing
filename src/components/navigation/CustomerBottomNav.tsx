import React from 'react';
import { Home, Clock, Bell, User } from 'lucide-react';

export type CustomerNavTab = 'home' | 'orders' | 'notifications' | 'profile';

export interface CustomerBottomNavProps {
  activeTab: CustomerNavTab;
  onChangeTab: (tab: CustomerNavTab) => void;
  unreadNotifications?: number;
}

export const CustomerBottomNav: React.FC<CustomerBottomNavProps> = ({
  activeTab,
  onChangeTab,
  unreadNotifications = 0,
}) => {
  const tabs = [
    { id: 'home' as CustomerNavTab, label: 'Home', icon: Home },
    { id: 'orders' as CustomerNavTab, label: 'Orders', icon: Clock },
    {
      id: 'notifications' as CustomerNavTab,
      label: 'Inbox',
      icon: Bell,
      badge: unreadNotifications,
    },
    { id: 'profile' as CustomerNavTab, label: 'Profile', icon: User },
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
              {tab.badge && tab.badge > 0 ? (
                <span className="absolute -top-1 -right-2 bg-lime text-navy font-bold text-[9px] w-4 h-4 rounded-full flex items-center justify-center">
                  {tab.badge}
                </span>
              ) : null}
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
