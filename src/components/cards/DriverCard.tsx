import React from 'react';
import { TOW_TYPE_LABELS } from '../../services/catalog';
import {
  Star,
  Phone,
  MessageSquare,
  AlertOctagon,
  ShieldCheck,
  Truck,
  XCircle,
} from 'lucide-react';
import { DriverPartner } from '../../types';
import { Avatar } from '../common/Avatar';
import { Button } from '../common/Button';

export interface DriverCardProps {
  driver: DriverPartner;
  etaMinutes?: number;
  /** Overrides the ETA text (e.g. "ETA unavailable"); no ETA is ever invented. */
  etaText?: string;
  onCall?: () => void;
  onChat?: () => void;
  onCancel?: () => void;
  onSos?: () => void;
  onViewProfile?: () => void;
  className?: string;
}

export const DriverCard: React.FC<DriverCardProps> = ({
  driver,
  etaMinutes,
  etaText,
  onCall,
  onChat,
  onCancel,
  onSos,
  onViewProfile,
  className = '',
}) => {
  return (
    <div
      className={`p-5 rounded-2xl bg-surface border border-line shadow-xl space-y-4 ${className}`}
    >
      {/* Top Driver Row */}
      <div className="flex items-start justify-between gap-3">
        <div
          onClick={onViewProfile}
          className={`flex items-center gap-3 ${onViewProfile ? 'cursor-pointer' : ''}`}
        >
          <Avatar src={driver.avatar} name={driver.name} size="lg" />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-ink">{driver.name}</h3>
              <span title="RTA & TowNow Verified">
                <ShieldCheck className="w-4 h-4 text-success" />
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted mt-0.5">
              <div className="flex items-center gap-1 text-navy font-semibold">
                <Star className="w-3.5 h-3.5 fill-warning" />
                <span className="tabular-nums">{driver.rating > 0 ? driver.rating.toFixed(2) : 'New'}</span>
              </div>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{driver.totalTrips} completed tows</span>
            </div>
            {onViewProfile && (
              <span className="text-[11px] text-navy font-medium">View profile ›</span>
            )}
          </div>
        </div>

        {/* Live ETA Box */}
        <div className="text-right bg-canvas/80 border border-line rounded-xl px-3 py-1.5 shrink-0">
          <div className="text-base font-bold text-navy tabular-nums">
            {etaText ?? (etaMinutes !== undefined ? `${etaMinutes} MIN` : '—')}
          </div>
          <div className="text-[10px] text-muted uppercase tracking-wider">Arriving In</div>
        </div>
      </div>

      {/* Tow Truck Vehicle Specification */}
      <div className="p-3 rounded-xl bg-canvas/70 border border-line flex items-center justify-between text-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-lime/20 border border-navy/20 text-navy flex items-center justify-center">
            <Truck className="w-4 h-4" />
          </div>
          <div>
            <div className="font-medium text-ink capitalize">
              {TOW_TYPE_LABELS[driver.vehicle.type] ?? driver.vehicle.type}
            </div>
            <div className="text-[11px] text-muted truncate max-w-[180px]">
              {driver.vehicle.model}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono font-bold text-ink bg-canvas px-2 py-0.5 rounded border border-line">
            {driver.vehicle.plateNumber}
          </div>
        </div>
      </div>

      {/* Action Buttons: Call, Chat, SOS, Cancel */}
      <div className="grid grid-cols-4 gap-2 pt-1">
        <button
          onClick={onCall}
          className="flex flex-col items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl bg-canvas hover:bg-line/80 text-ink transition-colors border border-line"
        >
          <Phone className="w-4 h-4 text-success" />
          <span className="text-[11px] font-medium">Call</span>
        </button>
        <button
          onClick={onChat}
          className="flex flex-col items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl bg-canvas hover:bg-line/80 text-ink transition-colors border border-line"
        >
          <MessageSquare className="w-4 h-4 text-info" />
          <span className="text-[11px] font-medium">Chat</span>
        </button>
        <button
          onClick={onSos}
          className="flex flex-col items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl bg-danger/10 hover:bg-danger/10 text-danger transition-colors border border-danger/30"
        >
          <AlertOctagon className="w-4 h-4 text-danger" />
          <span className="text-[11px] font-medium">SOS</span>
        </button>
        <button
          onClick={onCancel}
          className="flex flex-col items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl bg-canvas hover:bg-line/80 text-muted hover:text-ink transition-colors border border-line"
        >
          <XCircle className="w-4 h-4 text-muted" />
          <span className="text-[11px] font-medium">Cancel</span>
        </button>
      </div>
    </div>
  );
};
