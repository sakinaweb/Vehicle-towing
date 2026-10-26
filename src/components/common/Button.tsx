import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'amber';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  className = '',
  disabled,
  ...props
}) => {
  const baseClasses =
    'relative inline-flex items-center justify-center select-none transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none disabled:active:scale-100 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/40';

  // Mirrors the Flutter theme (design.dart): lime fill + navy text, 14 px radius, outlined = white + border.
  const sizeClasses = {
    sm: 'text-xs px-3 py-1.5 rounded-[10px] gap-1.5 min-h-[36px]',
    md: 'text-sm px-4 py-2.5 rounded-[14px] gap-2 min-h-[44px]',
    lg: 'text-[15px] px-5 py-3 rounded-[14px] gap-2.5 min-h-[52px]',
    xl: 'text-base px-6 py-3.5 rounded-[14px] gap-3 min-h-[56px]',
  };

  const variantClasses = {
    primary: 'bg-lime hover:brightness-95 text-navy font-extrabold',
    secondary: 'bg-surface hover:bg-canvas text-navy font-bold border-[1.4px] border-line',
    outline: 'bg-surface hover:bg-canvas text-navy font-bold border-[1.4px] border-line',
    ghost: 'bg-transparent hover:bg-navy/5 text-navy font-bold',
    danger: 'bg-danger hover:brightness-95 text-white font-bold',
    amber: 'bg-lime/25 hover:bg-lime/40 text-navy font-bold border border-lime',
  };

  return (
    <button
      className={`${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${
        fullWidth ? 'w-full' : ''
      } ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
      ) : leftIcon ? (
        <span className="shrink-0">{leftIcon}</span>
      ) : null}
      <span>{children}</span>
      {!isLoading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
    </button>
  );
};
