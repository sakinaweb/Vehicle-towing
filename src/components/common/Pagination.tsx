import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems?: number;
  itemsPerPage?: number;
}

export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  onPageChange,
  totalItems,
  itemsPerPage,
}) => {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 py-3 px-2 text-xs text-muted">
      <div>
        {totalItems !== undefined && itemsPerPage !== undefined && (
          <span>
            Showing <span className="font-semibold text-ink tabular-nums">{totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1}</span> to{' '}
            <span className="font-semibold text-ink tabular-nums">
              {Math.min(currentPage * itemsPerPage, totalItems)}
            </span>{' '}
            of <span className="font-semibold text-ink tabular-nums">{totalItems}</span> entries
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          className="p-1.5 rounded-lg border border-line bg-surface text-ink/80 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-canvas"
          aria-label="Previous Page"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="px-2 py-1 text-ink/80 tabular-nums font-medium">
          Page {currentPage} of {totalPages || 1}
        </span>
        <button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
          className="p-1.5 rounded-lg border border-line bg-surface text-ink/80 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-canvas"
          aria-label="Next Page"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
