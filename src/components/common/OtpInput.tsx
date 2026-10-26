import React, { useRef } from 'react';

export interface OtpInputProps {
  /** Entered digits; unfilled positions are spaces (e.g. "84 2"). */
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  hasError?: boolean;
  length?: number;
  disabled?: boolean;
}

/**
 * Six one-digit boxes with auto-advance, backspace-to-previous, paste of a full
 * code, overtyping and SMS autofill (autocomplete="one-time-code").
 */
export const OtpInput: React.FC<OtpInputProps> = ({
  value,
  onChange,
  onSubmit,
  hasError = false,
  length = 6,
  disabled = false,
}) => {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (index: number, raw: string) => {
    let digits = raw.replace(/\D/g, '');
    if (!digits && raw) return;
    const chars = value.padEnd(length, ' ').split('');
    // Overtyping a filled box: keep only the newly typed digit
    const existing = chars[index].trim();
    if (existing && digits.length === 2) {
      digits = digits.startsWith(existing) ? digits.slice(1) : digits.slice(0, 1);
    }
    if (digits.length > 1) {
      // Pasted or autofilled code: fill from this box onwards
      digits
        .slice(0, length - index)
        .split('')
        .forEach((d, i) => (chars[index + i] = d));
    } else {
      chars[index] = digits || ' ';
    }
    onChange(chars.join('').trimEnd());
    const focusIndex = Math.min(index + Math.max(digits.length, 1), length - 1);
    if (digits) refs.current[focusIndex]?.focus();
  };

  return (
    <div className="mt-8 flex justify-between gap-2 max-w-sm mx-auto">
      {Array.from({ length }, (_, i) => {
        const digit = (value[i] || '').trim();
        const isNext = i === Math.min(value.trimEnd().length, length - 1) && !digit;
        return (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            aria-label={`Digit ${i + 1}`}
            value={digit}
            disabled={disabled}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !digit && i > 0) {
                handleChange(i - 1, '');
                refs.current[i - 1]?.focus();
              } else if (e.key === 'Enter') {
                onSubmit?.();
              }
            }}
            className={`w-12 h-14 rounded-xl border text-xl font-bold font-mono text-center outline-none caret-amber-400 disabled:opacity-60 ${
              hasError
                ? 'border-danger bg-surface text-ink'
                : isNext
                ? 'border-navy bg-lime/20 text-navy'
                : 'border-line bg-surface text-ink focus:border-navy'
            }`}
          />
        );
      })}
    </div>
  );
};

/** Whole seconds until `isoTime` (0 when passed or unset), re-rendering every second. */
export function useSecondsUntil(isoTime: string | null): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!isoTime) return;
    setNow(Date.now()); // don't count from a stale "now" captured at mount
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isoTime]);
  return isoTime ? Math.max(0, Math.ceil((Date.parse(isoTime) - now) / 1000)) : 0;
}
