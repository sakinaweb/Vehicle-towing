import React from 'react';

export interface MobileContainerProps {
  children: React.ReactNode;
  frameMode?: boolean;
  screenTitle?: string;
}

/**
 * Pure Application Container
 * Renders the actual application interface directly without any simulated phone chassis,
 * fake device bezels, dynamic islands, or hardware notches.
 */
export const MobileContainer: React.FC<MobileContainerProps> = ({ children }) => {
  return (
    <div className="w-full flex-1 bg-canvas text-ink flex flex-col justify-start items-center">
      <div className="w-full max-w-4xl min-h-[calc(100vh-56px)] flex flex-col bg-canvas shadow-2xl border-x border-line">
        {children}
      </div>
    </div>
  );
};
