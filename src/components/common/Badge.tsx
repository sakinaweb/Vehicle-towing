import React from 'react';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'neutral' | 'emerald' | 'amber' | 'rose' | 'sky' | 'purple';
  size?: 'sm' | 'md';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'md',
  className = '',
}) => {
  const variantStyles = {
    neutral: 'bg-canvas text-ink/80 border border-line',
    emerald: 'bg-success/10 text-success border border-success/30',
    amber: 'bg-lime/15 text-navy border border-navy/50',
    rose: 'bg-danger/10 text-danger border border-danger/30',
    sky: 'bg-info/10 text-info border border-info/30',
    purple: 'bg-info/10 text-info border border-info/30',
  };

  const sizeStyles = {
    sm: 'text-[11px] px-2 py-0.5 rounded-md font-medium tracking-tight',
    md: 'text-xs px-2.5 py-1 rounded-lg font-medium',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
    >
      {children}
    </span>
  );
};
