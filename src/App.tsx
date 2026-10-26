import React, { useState } from 'react';
import {
  AppPersona,
  AppSwitcher,
} from './components/navigation/AppSwitcher';
import { CustomerApp } from './pages/customer/CustomerApp';
import { DriverApp } from './pages/driver/DriverApp';
import { AdminApp } from './pages/admin/AdminApp';
import { MobileContainer } from './layouts/MobileContainer';
import { ToastProvider } from './components/common/Toast';
import { AdminSection } from './components/navigation/AdminSidebar';

export default function App() {
  const [currentPersona, setCurrentPersona] = useState<AppPersona>('customer');
  const [customerScreen, setCustomerScreen] = useState<string>('home');
  const [driverScreen, setDriverScreen] = useState<string>('driver_home');
  const [adminSection, setAdminSection] = useState<AdminSection>('dashboard');

  // A bottom sheet left open in a now-hidden app must not keep the page scroll-locked
  React.useEffect(() => {
    document.body.style.overflow = '';
  }, [currentPersona]);

  return (
    <ToastProvider>
      <div className="min-h-screen bg-canvas text-ink flex flex-col font-sans selection:bg-lime/60 selection:text-navy">
        {/* Master Persona & Screen Switcher Bar */}
        <AppSwitcher
          currentPersona={currentPersona}
          onChangePersona={(persona) => setCurrentPersona(persona)}
          customerScreen={customerScreen}
          onChangeCustomerScreen={(s) => setCustomerScreen(s)}
          driverScreen={driverScreen}
          onChangeDriverScreen={(s) => setDriverScreen(s)}
          adminSection={adminSection}
          onChangeAdminSection={(sec) => setAdminSection(sec as AdminSection)}
        />

        {/* Pure Application Viewport (No Phone Frame) */}
        {/* All three apps stay mounted (inactive ones hidden) so switching keeps their state */}
        <div className="flex-1 flex flex-col w-full">
          <div className={currentPersona === 'customer' ? 'contents' : 'hidden'}>
            <MobileContainer>
              <CustomerApp
                initialScreen={customerScreen}
                onScreenChange={(s) => setCustomerScreen(s)}
              />
            </MobileContainer>
          </div>

          <div className={currentPersona === 'driver' ? 'contents' : 'hidden'}>
            <MobileContainer>
              <DriverApp
                initialScreen={driverScreen}
                onScreenChange={(s) => setDriverScreen(s)}
              />
            </MobileContainer>
          </div>

          <div className={currentPersona === 'admin' ? 'contents' : 'hidden'}>
            <AdminApp
              initialSection={adminSection}
              onSectionChange={(sec) => setAdminSection(sec)}
            />
          </div>
        </div>
      </div>
    </ToastProvider>
  );
}
