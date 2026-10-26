import { useState } from 'react';
import { useSecondsUntil } from '../components/common/OtpInput';
import { ApiError, SessionResponse, isSpentOtpRejection } from './api';
import { formatLocal, toSignInE164 } from './phone';
import type { useAuth } from './useAuth';

const GENERIC_ERROR = 'Something went wrong. Please try again.';

interface Callbacks {
  onCodeSent: () => void;
  onSignedIn: (session: SessionResponse) => void;
  /** Called when the OTP screen is reached without a valid phone number. */
  onNeedPhone: () => void;
  notify: (message: string, type: 'info' | 'error') => void;
}

/** Phone → SMS code → session flow shared by the customer and driver apps. */
export function useOtpSignIn(auth: ReturnType<typeof useAuth>, callbacks: Callbacks) {
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [otp, setOtpValue] = useState('');
  const [otpError, setOtpError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendAvailableAt, setResendAvailableAt] = useState<string | null>(null);
  const resendIn = useSecondsUntil(resendAvailableAt);

  /** Requests an SMS code; returns an error message, or null on success. */
  const sendCode = async (): Promise<string | null> => {
    const e164 = toSignInE164(phone);
    if (!e164) return 'Enter a valid UAE mobile number, e.g. 50 123 4567';
    setBusy(true);
    try {
      const sent = await auth.requestOtp(e164);
      setResendAvailableAt(sent.resendAvailableAt);
      setPhone(formatLocal(e164));
      return null;
    } catch (err) {
      return err instanceof ApiError ? err.message : GENERIC_ERROR;
    } finally {
      setBusy(false);
    }
  };

  const submitPhone = async () => {
    setPhoneError('');
    const error = await sendCode();
    if (error) {
      setPhoneError(error);
      return;
    }
    setOtpValue('');
    setOtpError('');
    callbacks.onCodeSent();
  };

  const resendCode = async () => {
    if (resendIn > 0 || busy) return;
    const error = await sendCode();
    setOtpValue('');
    setOtpError('');
    callbacks.notify(error ?? 'A new code was sent by SMS', error ? 'error' : 'info');
  };

  const verifyOtp = async () => {
    if (!/^\d{6}$/.test(otp)) {
      setOtpError('Enter the complete 6-digit code');
      return;
    }
    const e164 = toSignInE164(phone);
    if (!e164) {
      callbacks.onNeedPhone();
      return;
    }
    setBusy(true);
    try {
      const session = await auth.verifyOtp(e164, otp);
      setOtpValue('');
      callbacks.onSignedIn(session);
    } catch (err) {
      if (isSpentOtpRejection(err)) {
        // Back to the number step, so the real reason isn't replaced by "code expired" on a retry.
        setOtpValue('');
        setPhoneError(err.message);
        callbacks.onNeedPhone();
        return;
      }
      setOtpError(err instanceof ApiError ? err.message : GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  };

  return {
    phone,
    setPhone: (value: string) => {
      setPhone(value.replace(/[^\d\s+]/g, ''));
      setPhoneError('');
    },
    phoneError,
    otp,
    setOtp: (value: string) => {
      setOtpValue(value);
      setOtpError('');
    },
    otpError,
    busy,
    resendIn,
    submitPhone,
    resendCode,
    verifyOtp,
  };
}
