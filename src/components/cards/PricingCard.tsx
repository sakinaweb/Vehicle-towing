import React from 'react';
import { ShieldCheck, Zap } from 'lucide-react';
import { TowType } from '../../types';

export interface PricingCardProps {
  towType: TowType;
  title: string;
  description: string;
  baseFare: number;
  perKm: number;
  estArrivalMin: number;
  selected?: boolean;
  onSelect?: () => void;
  imageUrl?: string;
}

export const PricingCard: React.FC<PricingCardProps> = ({
  towType,
  title,
  description,
  baseFare,
  perKm,
  estArrivalMin,
  selected = false,
  onSelect,
  imageUrl,
}) => {
  return (
    <div
      onClick={onSelect}
      className={`relative p-4 rounded-2xl border transition-all select-none ${
        selected
          ? 'bg-surface border-navy shadow-lg ring-1 ring-navy/20'
          : 'bg-surface/60 border-line hover:border-line hover:bg-surface'
      } ${onSelect ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-ink">{title}</h4>
            {selected && (
              <span className="text-[10px] font-medium text-navy bg-lime/20 px-1.5 py-0.2 rounded border border-navy/20">
                Recommended
              </span>
            )}
          </div>
          <p className="text-xs text-muted mt-1 line-clamp-2">{description}</p>
          <div className="flex items-center gap-2 mt-2 text-[11px] text-muted">
            <span className="flex items-center gap-1 text-success">
              <Zap className="w-3 h-3" />
              <span>{estArrivalMin} min arrival</span>
            </span>
            <span>·</span>
            <span>AED {perKm}/km</span>
          </div>
        </div>

        {/* Vehicle Thumbnail with image fallback */}
        <div className="w-20 h-14 rounded-xl overflow-hidden bg-canvas border border-line shrink-0 relative">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={title}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs text-muted">
              {towType}
            </div>
          )}
        </div>
      </div>

      {/* Price Footer */}
      <div className="mt-3 pt-3 border-t border-line flex items-center justify-between text-xs">
        <span className="text-muted">Starting from</span>
        <div className="text-right">
          <span className="text-base font-bold text-navy tabular-nums">AED {baseFare}</span>
          <span className="text-[10px] text-muted ml-1">+ 5% VAT</span>
        </div>
      </div>
    </div>
  );
};
