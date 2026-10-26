import React from 'react';

export interface LoadingSkeletonProps {
  className?: string;
}

export const Skeleton: React.FC<LoadingSkeletonProps> = ({ className = 'h-4 w-full' }) => {
  return (
    <div
      className={`animate-pulse bg-canvas/80 rounded-lg ${className}`}
      aria-hidden="true"
    />
  );
};

export const BookingCardSkeleton: React.FC = () => {
  return (
    <div className="p-4 rounded-2xl border border-line bg-surface/60 space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-16" />
      </div>
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 rounded-xl" />
        <div className="space-y-1.5 flex-1">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <div className="pt-2 border-t border-line flex justify-between">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-4 w-14" />
      </div>
    </div>
  );
};
