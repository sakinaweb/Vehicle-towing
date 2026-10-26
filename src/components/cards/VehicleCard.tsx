import React from 'react';
import { Car, Bike, CheckCircle2 } from 'lucide-react';
import { CustomerVehicle } from '../../types';

export interface VehicleCardProps {
  vehicle: CustomerVehicle;
  selected?: boolean;
  onSelect?: () => void;
  showActions?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}

export const VehicleCard: React.FC<VehicleCardProps> = ({
  vehicle,
  selected = false,
  onSelect,
  showActions = false,
  onEdit,
  onDelete,
}) => {
  return (
    <div
      onClick={onSelect}
      className={`relative p-4 rounded-2xl border transition-all select-none ${
        selected
          ? 'bg-surface border-navy shadow-md ring-1 ring-navy/20'
          : 'bg-surface/70 border-line hover:border-line hover:bg-surface'
      } ${onSelect ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border ${
              vehicle.category === 'car'
                ? 'bg-canvas border-line text-ink'
                : 'bg-lime/20 border-navy/20 text-navy'
            }`}
          >
            {vehicle.category === 'car' ? (
              <Car className="w-5 h-5" />
            ) : (
              <Bike className="w-5 h-5" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-ink">
                {vehicle.brand} {vehicle.model}
              </h4>
              {vehicle.isDefault && (
                <span className="text-[10px] font-medium text-navy bg-lime/20 px-1.5 py-0.2 rounded border border-navy/20">
                  Default
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted mt-0.5">
              <span>{vehicle.year}</span>
              <span aria-hidden="true">·</span>
              <span>{vehicle.color}</span>
            </div>
          </div>
        </div>

        {/* Selected Checkmark or UAE Plate Badge */}
        {selected ? (
          <CheckCircle2 className="w-5 h-5 text-navy shrink-0" />
        ) : null}
      </div>

      {/* UAE Authentic License Plate Graphic */}
      <div className="mt-3.5 pt-3 border-t border-line flex items-center justify-between">
        <div className="inline-flex items-center bg-white text-navy font-bold px-2.5 py-1 rounded-md border border-line shadow-xs text-xs tracking-wider font-mono">
          <span className="text-[10px] text-muted mr-1.5 uppercase font-sans font-semibold">
            {vehicle.plateEmirate} {vehicle.plateCode}
          </span>
          <span className="tabular-nums tracking-widest">{vehicle.plateNumber}</span>
        </div>

        {showActions && (
          <div className="flex items-center gap-3 text-xs text-muted">
            {onEdit && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                className="hover:text-navy transition-colors"
              >
                Edit
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="hover:text-danger transition-colors"
              >
                Remove
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
