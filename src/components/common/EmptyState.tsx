import React from 'react';
import { Button } from './Button';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className = '',
}) => {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center p-8 rounded-2xl border border-dashed border-line bg-surface/30 ${className}`}
    >
      {icon && (
        <div className="w-12 h-12 rounded-2xl bg-canvas/80 border border-line flex items-center justify-center text-muted mb-4">
          {icon}
        </div>
      )}
      <h4 className="text-sm font-semibold text-ink">{title}</h4>
      <p className="text-xs text-muted max-w-sm mt-1 mb-5">{description}</p>
      {actionLabel && onAction && (
        <Button variant="secondary" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
};
