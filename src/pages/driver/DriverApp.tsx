import React, { useState } from 'react';
import {
  Truck,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Camera,
  Navigation,
  Phone,
  MessageSquare,
  DollarSign,
  Star,
  ChevronRight,
  ChevronLeft,
  Clock,
  MapPin,
  Flame,
  ArrowRight,
  Upload,
  User,
  Power,
  RotateCcw,
  Check,
  AlertOctagon,
  Calendar,
  Layers,
  HelpCircle,
  Eye,
  Bell,
} from 'lucide-react';
import { DriverPartner, TowType } from '../../types';
import { getInbox, Inbox, markAllRead, timeAgo } from '../../services/notifications';
import { TOW_TYPE_LABELS } from '../../services/catalog';
import { EmptyState } from '../../components/common/EmptyState';
import { Skeleton } from '../../components/common/LoadingSkeleton';
import { Button } from '../../components/common/Button';
import { Badge } from '../../components/common/Badge';
import { StatusBadge } from '../../components/common/StatusBadge';
import { Avatar } from '../../components/common/Avatar';
import { MapPanel } from '../../components/map/MapPanel';
import { Modal } from '../../components/common/Modal';
import { DriverBottomNav, DriverNavTab } from '../../components/navigation/DriverBottomNav';
import { useToast } from '../../components/common/Toast';
import { OtpInput, useSecondsUntil } from '../../components/common/OtpInput';
import { formatAed, toUiPlace, withLiveLocation } from '../../services/bookings';
import {
  acceptOffer,
  advanceTrip,
  Checklist,
  CHECKLIST_ITEMS,
  declineOffer,
  DOCUMENT_LABELS,
  DocumentType,
  DriverDocument,
  FuelLevel,
  Inspection,
  listDocuments,
  listJobInspections,
  MAX_EXTRA_PHOTOS,
  REQUIRED_SLOTS,
  saveInspection,
  submitInspection,
  TripStep,
  uploadDocument,
  uploadInspectionPhoto,
  DriverAvailability,
  DriverJob,
  getAvailability,
  getCurrentJob,
  getCurrentOffer,
  JobOffer,
  postLocation,
  setAvailability,
  startEnRoute,
} from '../../services/dispatch';
import { useRealtime } from '../../services/realtime';
import { DriverLedger, getEarnings, LedgerEntry, recordCashCollected } from '../../services/payments';
import { Input } from '../../components/common/Input';
import { ApiError } from '../../services/api';
import { displayPhone, formatLocal } from '../../services/phone';
import { DriverProfile, getDriverProfile, updateDriverProfile } from '../../services/profile';
import { useAuth } from '../../services/useAuth';
import { useOtpSignIn } from '../../services/useOtpSignIn';

const KYC_LABELS: Record<DriverProfile['kycStatus'], string> = {
  pending: 'KYC pending verification',
  approved: 'KYC approved',
  rejected: 'KYC rejected — re-submit documents',
  suspended: 'Account suspended',
};

/** Optional support line (like the mobile SUPPORT_PHONE build setting); hidden when not set. */
const SUPPORT_PHONE = (import.meta.env.VITE_SUPPORT_PHONE as string | undefined)?.trim() || '';

const LEDGER_LABELS: Record<LedgerEntry['type'], string> = {
  trip_earning: 'Trip earning (after commission)',
  cash_collected: 'Cash collected from customer',
  remittance: 'Paid to TowNow',
  payout: 'Paid out by TowNow',
};


export interface DriverAppProps {
  initialScreen?: string;
  onScreenChange?: (screen: string) => void;
}

export const DriverApp: React.FC<DriverAppProps> = ({
  initialScreen = 'driver_home',
  onScreenChange,
}) => {
  const { showToast } = useToast();

  const [currentScreen, setCurrentScreen] = useState<string>(initialScreen);
  // Vehicle inspection form (pickup or return, decided by the job status)
  const ALL_OK = Object.fromEntries(CHECKLIST_ITEMS.map((i) => [i, 'ok'])) as Checklist;
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [odometer, setOdometer] = useState('');
  const [fuelLevel, setFuelLevel] = useState<FuelLevel>('half');
  const [checklist, setChecklist] = useState<Checklist>(ALL_OK);
  const [inspectionNotes, setInspectionNotes] = useState('');
  const [slotFiles, setSlotFiles] = useState<Partial<Record<'front' | 'back' | 'left' | 'right', File>>>({});
  const [extraFiles, setExtraFiles] = useState<File[]>([]);
  const [completedJob, setCompletedJob] = useState<DriverJob | null>(null);
  const [cashRecorded, setCashRecorded] = useState(false);
  const [ledger, setLedger] = useState<DriverLedger | null>(null);
  const [myFix, setMyFix] = useState<{ lat: number; lng: number } | null>(null);
  const [documents, setDocuments] = useState<DriverDocument[]>([]);
  const [documentNumber, setDocumentNumber] = useState('');
  const [cashCollected, setCashCollected] = useState(false);

  // Driver notifications (GET /me/notifications)
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const unreadCount = inbox?.unread ?? 0;

  React.useEffect(() => {
    if (initialScreen && initialScreen !== currentScreen) {
      setCurrentScreen(initialScreen);
    }
  }, [initialScreen]);

  const navigateTo = (screen: string) => {
    setCurrentScreen(screen);
    onScreenChange?.(screen);
  };
  // Derived from the current screen so it stays correct however the screen was reached
  const bottomNavTab: DriverNavTab =
    currentScreen === 'job_history'
      ? 'jobs'
      : currentScreen === 'earnings'
      ? 'earnings'
      : ['profile', 'documents', 'support'].includes(currentScreen)
      ? 'profile'
      : 'home';

  const handleBottomNavChange = (tab: DriverNavTab) => {
    if (tab === 'home') navigateTo('driver_home');
    else if (tab === 'jobs') navigateTo('job_history');
    else if (tab === 'earnings') navigateTo('earnings');
    else if (tab === 'profile') navigateTo('profile');
  };


  // Authentication & profile (real API, see backend/src/modules/auth and drivers)
  const auth = useAuth('driver');
  const signIn = useOtpSignIn(auth, {
    onCodeSent: () => navigateTo('otp'),
    onSignedIn: (session) => {
      // New partners start onboarding; returning partners go straight to their dashboard.
      navigateTo(session.isNewUser ? 'kyc_intro' : 'driver_home');
      showToast(session.isNewUser ? 'Welcome to TowNow Partners!' : 'Signed in', 'success');
    },
    onNeedPhone: () => navigateTo('login'),
    notify: (message, type) => showToast(message, type),
  });
  const [driverProfile, setDriverProfile] = useState<DriverProfile | null>(null);
  const [profileError, setProfileError] = useState('');
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState('');
  const [editExperience, setEditExperience] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const partnerName = auth.user?.fullName ?? 'TowNow Partner';

  // Dispatch: availability, location sharing, offers and the current job (real API + Socket.IO)
  const [availability, setAvailabilityState] = useState<DriverAvailability>('offline');
  const isOnline = availability !== 'offline';
  const [offer, setOffer] = useState<JobOffer | null>(null);
  const [currentJob, setCurrentJob] = useState<DriverJob | null>(null);
  const [dispatchBusy, setDispatchBusy] = useState(false);
  const offerSecondsLeft = useSecondsUntil(offer?.expiresAt ?? null);

  const refreshDispatch = React.useCallback(async () => {
    const [a, o, j] = await Promise.all([
      getAvailability(auth.client),
      getCurrentOffer(auth.client),
      getCurrentJob(auth.client),
    ]);
    setAvailabilityState(a.availability);
    setOffer(o);
    setCurrentJob(j);
  }, [auth.client]);

  React.useEffect(() => {
    if (!auth.user) {
      setAvailabilityState('offline');
      setOffer(null);
      setCurrentJob(null);
      return;
    }
    refreshDispatch().catch(() => undefined);
  }, [auth.user, refreshDispatch]);

  // REST fallback: offers also arrive over Socket.IO, this just catches anything missed.
  React.useEffect(() => {
    if (!auth.user || availability === 'offline') return;
    const timer = setInterval(() => refreshDispatch().catch(() => undefined), 10_000);
    return () => clearInterval(timer);
  }, [auth.user, availability, refreshDispatch]);

  const realtime = useRealtime(auth.client, auth.user?.id ?? null, {
    'offer:new': (incoming: JobOffer) => {
      setOffer(incoming);
      navigateTo('incoming_job');
      showToast(`New tow request ${incoming.bookingNumber}`, 'info');
    },
    'offer:closed': (e: { offerId: string; reason: string }) => {
      setOffer((cur) => (cur?.offerId === e.offerId ? null : cur));
      if (currentScreen === 'incoming_job') {
        navigateTo('driver_home');
        showToast(
          e.reason === 'expired'
            ? 'The offer expired and was passed to another driver'
            : 'This request was cancelled',
          'info',
        );
      }
    },
    'kyc:updated': (e: { kycStatus: string }) => {
      getDriverProfile(auth.client).then(setDriverProfile).catch(() => undefined);
      showToast(
        e.kycStatus === 'approved'
          ? 'Your documents were approved — you can go online.'
          : 'Your verification needs attention. See KYC status.',
        e.kycStatus === 'approved' ? 'success' : 'error',
      );
    },
    'job:cancelled': () => {
      setCurrentJob(null);
      refreshDispatch().catch(() => undefined);
      showToast('The customer cancelled the job', 'info');
      navigateTo('driver_home');
    },
  });

  // Share GPS while online: Socket.IO first, REST fallback. The server takes the driver from the token.
  React.useEffect(() => {
    if (!auth.user || availability === 'offline' || !('geolocation' in navigator)) return;
    let lastSent = 0;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (Date.now() - lastSent < 5_000) return; // throttle
        lastSent = Date.now();
        setMyFix({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        const heading = pos.coords.heading;
        const fix = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          recordedAt: new Date(pos.timestamp).toISOString(),
          accuracyMeters: Math.round(pos.coords.accuracy),
          ...(heading !== null && !Number.isNaN(heading) && { headingDegrees: heading }),
        };
        void realtime.emitWithAck<{ ok: boolean }>('driver:location', fix).then((ack) => {
          if (!ack) postLocation(auth.client, fix).catch(() => undefined);
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          showToast('Allow location access so TowNow can send you nearby jobs.', 'error');
        }
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [auth.user, availability]);

  const toggleAvailability = async () => {
    if (!auth.user) {
      showToast('Sign in to go online', 'info');
      navigateTo('login');
      return;
    }
    const target = availability === 'offline' ? 'online' : 'offline';
    setDispatchBusy(true);
    try {
      const result = await setAvailability(auth.client, target);
      setAvailabilityState(result.availability);
      if (target === 'offline') setOffer(null);
      showToast(target === 'online' ? 'Shift Active (Online)' : 'Shift Paused (Offline)', 'info');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not change your status.', 'error');
    } finally {
      setDispatchBusy(false);
    }
  };

  const acceptCurrentOffer = async () => {
    if (!offer) return;
    setDispatchBusy(true);
    try {
      const job = await acceptOffer(auth.client, offer.offerId);
      setCurrentJob(job);
      setOffer(null);
      setAvailabilityState('busy');
      showToast('Job accepted! Head to the pickup.', 'success');
      navigateTo('accept_job');
    } catch (err) {
      setOffer(null);
      showToast(err instanceof ApiError ? err.message : 'Could not accept the job.', 'error');
      navigateTo('driver_home');
    } finally {
      setDispatchBusy(false);
    }
  };

  const declineCurrentOffer = async () => {
    if (!offer) return;
    setDispatchBusy(true);
    try {
      await declineOffer(auth.client, offer.offerId);
      showToast('Job declined', 'info');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not decline the job.', 'error');
    } finally {
      setOffer(null);
      setDispatchBusy(false);
      navigateTo('driver_home');
    }
  };

  const beginEnRoute = async () => {
    if (!currentJob) {
      navigateTo('navigation');
      return;
    }
    setDispatchBusy(true);
    try {
      setCurrentJob(await startEnRoute(auth.client, currentJob.bookingId));
      setAvailabilityState('en_route');
      navigateTo('navigation');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not start the job.', 'error');
    } finally {
      setDispatchBusy(false);
    }
  };

  /** Where to resume a job in progress. */
  const resumeScreen = (job: DriverJob): string => {
    switch (job.status) {
      case 'driver_assigned':
        return 'accept_job';
      case 'driver_arriving':
        return 'navigation';
      case 'driver_arrived':
        return job.inspections.pickup === 'submitted' ? 'vehicle_loaded' : 'arrived';
      case 'in_transit':
        return job.inspections.return === 'submitted' ? 'complete_job' : 'in_transit';
      default:
        return 'driver_home';
    }
  };

  const runTripStep = async (step: TripStep, next: string) => {
    if (!currentJob) return;
    setDispatchBusy(true);
    try {
      const job = await advanceTrip(auth.client, currentJob.bookingId, step);
      if (job.status === 'completed') {
        setCompletedJob(job);
        setCashRecorded(false);
        setCurrentJob(null);
        setAvailabilityState('online');
        showToast('Tow completed. Great job!', 'success');
      } else {
        setCurrentJob(job);
        setAvailabilityState(step === 'en-route' ? 'en_route' : 'busy');
      }
      navigateTo(next);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not update the job.', 'error');
      refreshDispatch().catch(() => undefined);
    } finally {
      setDispatchBusy(false);
    }
  };

  const inspectionStage = currentJob?.status === 'in_transit' ? 'return' : 'pickup';

  // Load the saved (draft or submitted) inspection whenever the form opens.
  React.useEffect(() => {
    if (currentScreen !== 'vehicle_inspection' || !currentJob) return;
    setSlotFiles({});
    setExtraFiles([]);
    listJobInspections(auth.client, currentJob.bookingId)
      .then((all) => {
        const saved = all.find((i) => i.stage === inspectionStage) ?? null;
        const pickup = all.find((i) => i.stage === 'pickup');
        setInspection(saved);
        setOdometer(saved ? String(saved.odometerKm) : inspectionStage === 'return' && pickup ? String(pickup.odometerKm) : '');
        setFuelLevel(saved?.fuelLevel ?? 'half');
        setChecklist(saved?.checklist ?? ALL_OK);
        setInspectionNotes(saved?.notes ?? '');
      })
      .catch(() => undefined);
  }, [currentScreen, currentJob?.bookingId, inspectionStage]);

  const submitCurrentInspection = async () => {
    if (!currentJob) return;
    const km = Number(odometer);
    if (odometer.trim() === '' || !Number.isInteger(km) || km < 0) {
      showToast('Enter the odometer reading in whole km.', 'error');
      return;
    }
    setDispatchBusy(true);
    try {
      const id = currentJob.bookingId;
      let saved = await saveInspection(auth.client, id, inspectionStage, {
        odometerKm: km,
        fuelLevel,
        checklist,
        ...(inspectionNotes.trim() && { notes: inspectionNotes.trim() }),
      });
      for (const slot of REQUIRED_SLOTS) {
        const file = slotFiles[slot as keyof typeof slotFiles];
        if (file) saved = await uploadInspectionPhoto(auth.client, id, inspectionStage, slot, file);
      }
      for (const file of extraFiles) saved = await uploadInspectionPhoto(auth.client, id, inspectionStage, 'extra', file);
      setSlotFiles({});
      setExtraFiles([]);
      setInspection(saved);
      const missing = REQUIRED_SLOTS.filter((slot) => !saved.photos.some((ph) => ph.slot === slot));
      if (missing.length) {
        showToast(`Saved. Still needed: ${missing.join(', ')} photo${missing.length > 1 ? 's' : ''}.`, 'info');
        return;
      }
      setInspection(await submitInspection(auth.client, id, inspectionStage));
      const job = await getCurrentJob(auth.client);
      setCurrentJob(job);
      showToast(`${inspectionStage === 'pickup' ? 'Pickup' : 'Return'} inspection submitted`, 'success');
      navigateTo(inspectionStage === 'pickup' ? 'vehicle_loaded' : 'complete_job');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not save the inspection.', 'error');
    } finally {
      setDispatchBusy(false);
    }
  };

  // KYC documents (real upload, private storage on the server)
  const KYC_SCREEN_DOC: Record<string, DocumentType> = {
    emirates_id: 'emirates_id',
    driving_licence: 'driving_licence',
    vehicle_reg: 'vehicle_registration',
    insurance: 'commercial_insurance',
  };
  React.useEffect(() => {
    if (!auth.user || !(currentScreen in KYC_SCREEN_DOC || currentScreen === 'kyc_status')) return;
    setDocumentNumber('');
    listDocuments(auth.client).then(setDocuments).catch(() => undefined);
    getDriverProfile(auth.client).then(setDriverProfile).catch(() => undefined);
  }, [currentScreen, auth.user]);

  const uploadKycDocument = async (type: DocumentType, file: File | undefined) => {
    if (!file) return;
    if (!auth.user) {
      showToast('Sign in to upload your documents', 'info');
      navigateTo('login');
      return;
    }
    setDispatchBusy(true);
    try {
      await uploadDocument(auth.client, type, file, documentNumber.trim() || undefined);
      setDocuments(await listDocuments(auth.client));
      getDriverProfile(auth.client).then(setDriverProfile).catch(() => undefined);
      showToast(`${DOCUMENT_LABELS[type]} uploaded for review`, 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not upload the document.', 'error');
    } finally {
      setDispatchBusy(false);
    }
  };

  const confirmCash = async () => {
    if (!completedJob) return;
    setDispatchBusy(true);
    try {
      await recordCashCollected(auth.client, completedJob.bookingId, completedJob.fareTotalFils);
      setCashRecorded(true);
      showToast('Cash collection recorded', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not record the cash.', 'error');
    } finally {
      setDispatchBusy(false);
    }
  };

  // Settlement balance from the ledger (earnings screen).
  React.useEffect(() => {
    if (!['driver_home', 'earnings', 'earnings_details', 'job_history', 'online_toggle'].includes(currentScreen) || !auth.user) return;
    getEarnings(auth.client).then(setLedger).catch(() => undefined);
  }, [currentScreen, auth.user]);
  React.useEffect(() => {
    if (!['driver_home', 'notifications'].includes(currentScreen) || !auth.user) return;
    getInbox(auth.client).then(setInbox).catch(() => undefined);
  }, [currentScreen, auth.user]);
  // Completed jobs = trip_earning ledger entries (one per completed tow).
  const tripEntries = (ledger?.entries ?? []).filter((e) => e.type === 'trip_earning');
  const todayEntries = tripEntries.filter((e) => new Date(e.createdAt).toDateString() === new Date().toDateString());

  const noActiveJob = (title = 'No active job') => (
    <div className="flex-1 flex flex-col justify-center items-center p-6 bg-canvas text-ink text-center space-y-3">
      <Truck className="w-10 h-10 text-muted" />
      <h2 className="text-lg font-bold text-ink">{title}</h2>
      <p className="text-xs text-muted max-w-xs">Accepted jobs appear here and on your dashboard.</p>
      <Button variant="primary" size="md" onClick={() => navigateTo('driver_home')}>
        Back to Dashboard
      </Button>
    </div>
  );

  const directionsUrl = (to: { lat: number; lng: number }) =>
    `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}&travelmode=driving`;

  // Offer countdown reached zero: the server expires it; drop it locally too.
  React.useEffect(() => {
    if (offer && offerSecondsLeft === 0 && Date.parse(offer.expiresAt) <= Date.now()) {
      setOffer(null);
      if (currentScreen === 'incoming_job') {
        showToast('The offer expired and was passed to another driver', 'info');
        navigateTo('driver_home');
      }
    }
  }, [offerSecondsLeft]);

  React.useEffect(() => {
    if (!auth.user) {
      setDriverProfile(null);
      return;
    }
    let active = true;
    getDriverProfile(auth.client)
      .then((profile) => active && setDriverProfile(profile))
      .catch((err: unknown) => {
        if (active) setProfileError(err instanceof ApiError ? err.message : 'Could not load your profile.');
      });
    return () => {
      active = false;
    };
  }, [auth.user, auth.client]);

  const startEditProfile = () => {
    setEditName(auth.user?.fullName ?? '');
    setEditExperience(String(driverProfile?.experienceYears ?? 0));
    setProfileError('');
    setIsEditingProfile(true);
  };

  const saveProfile = async () => {
    const years = Number(editExperience);
    if (!Number.isInteger(years) || years < 0 || years > 60) {
      setProfileError('Years of experience must be a whole number between 0 and 60.');
      return;
    }
    setSavingProfile(true);
    setProfileError('');
    try {
      const profile = await updateDriverProfile(auth.client, {
        ...(editName.trim() && { fullName: editName }),
        experienceYears: years,
      });
      setDriverProfile(profile);
      auth.setUser(profile.user);
      setIsEditingProfile(false);
      showToast('Profile updated', 'success');
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : 'Could not save. Please try again.');
    } finally {
      setSavingProfile(false);
    }
  };

  const signOut = async () => {
    await auth.logout().catch(() => undefined);
    setIsEditingProfile(false);
    showToast('Signed out', 'info');
    navigateTo('login');
  };

  /* -------------------------------------------------------------
   * 1. DRIVER LOGIN
   * ------------------------------------------------------------- */
  if (currentScreen === 'login') {
    return (
      <div className="flex-1 flex flex-col justify-between p-6 bg-canvas text-ink">
        <div>
          <div className="w-12 h-12 rounded-2xl bg-lime text-navy flex items-center justify-center font-black text-xl mb-6">
            TN
          </div>
          <h2 className="text-2xl font-bold text-ink">Partner & Driver Portal</h2>
          <p className="text-xs text-muted mt-1">
            Sign in to your TowNow UAE fleet partner account.
          </p>

          <div className="mt-8 space-y-4">
            <div>
              <label className="block text-xs font-medium text-ink/80 mb-1.5">
                Registered Driver Mobile
              </label>
              <div className="flex items-center gap-2">
                <span className="px-3 py-2.5 rounded-xl bg-surface border border-line text-xs font-bold text-ink">
                  🇦🇪 +971
                </span>
                <input
                  type="tel"
                  inputMode="tel"
                  aria-label="Registered Driver Mobile"
                  value={signIn.phone}
                  maxLength={13}
                  placeholder="50 XXX XXXX"
                  onChange={(e) => signIn.setPhone(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void signIn.submitPhone()}
                  className={`flex-1 bg-surface text-ink font-mono text-sm rounded-xl border px-3.5 py-2.5 outline-none ${
                    signIn.phoneError ? 'border-danger' : 'border-line focus:border-navy'
                  }`}
                />
              </div>
              {signIn.phoneError && (
                <p className="mt-1.5 text-xs text-danger font-medium">{signIn.phoneError}</p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-2 pb-4">
          <Button variant="primary" fullWidth size="lg" onClick={signIn.submitPhone} isLoading={signIn.busy}>
            Request Driver OTP
          </Button>
          <Button variant="ghost" fullWidth size="sm" onClick={() => navigateTo('kyc_intro')}>
            Apply as New Towing Partner
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 2. DRIVER OTP
   * ------------------------------------------------------------- */
  if (currentScreen === 'otp') {
    return (
      <div className="flex-1 flex flex-col justify-between p-6 bg-canvas text-ink">
        <div>
          <button
            onClick={() => navigateTo('login')}
            className="p-1 -ml-1 text-muted hover:text-ink flex items-center gap-1 text-xs"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Change Number</span>
          </button>
          <h2 className="text-2xl font-bold text-ink mt-6">Driver Passcode</h2>
          <p className="text-xs text-muted mt-1">Enter 6 digits sent to {displayPhone(signIn.phone)}</p>

          <OtpInput
            value={signIn.otp}
            onChange={signIn.setOtp}
            onSubmit={signIn.verifyOtp}
            hasError={!!signIn.otpError}
            disabled={signIn.busy}
          />
          {signIn.otpError && (
            <p className="mt-3 text-center text-xs text-danger font-medium">{signIn.otpError}</p>
          )}

          <div className="mt-6 text-center">
            {signIn.resendIn > 0 && (
              <p className="text-xs text-muted">
                Resend code in{' '}
                <span className="text-navy font-mono font-semibold">
                  00:{String(signIn.resendIn).padStart(2, '0')}
                </span>
              </p>
            )}
            <button
              onClick={signIn.resendCode}
              disabled={signIn.resendIn > 0 || signIn.busy}
              className="mt-2 text-xs font-semibold text-muted hover:text-ink disabled:opacity-40 disabled:hover:text-muted"
            >
              Resend Code
            </button>
          </div>
        </div>

        <div className="pb-4">
          <Button variant="primary" fullWidth size="lg" onClick={signIn.verifyOtp} isLoading={signIn.busy}>
            Verify & Start Shift
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 3. KYC INTRODUCTION
   * ------------------------------------------------------------- */
  if (currentScreen === 'kyc_intro') {
    return (
      <div className="flex-1 flex flex-col justify-between p-6 bg-canvas text-ink">
        <div>
          <h2 className="text-xl font-bold text-ink">UAE Partner Onboarding</h2>
          <p className="text-xs text-muted mt-1">
            Complete the 4-step compliance check mandated by Dubai RTA and UAE Ministry of
            Interior.
          </p>

          <div className="mt-6 space-y-3">
            {[
              {
                step: '1',
                title: 'Emirates ID',
                desc: 'Valid UAE residency card (front & back)',
                screen: 'emirates_id',
              },
              {
                step: '2',
                title: 'Heavy Vehicle License',
                desc: 'RTA Category 4/6 Commercial Driving License',
                screen: 'driving_licence',
              },
              {
                step: '3',
                title: 'Vehicle Mulkiya',
                desc: 'Commercial recovery vehicle registration card',
                screen: 'vehicle_reg',
              },
              {
                step: '4',
                title: 'Commercial Insurance',
                desc: 'Comprehensive carrier cargo liability policy',
                screen: 'insurance',
              },
            ].map((k) => (
              <div
                key={k.step}
                onClick={() => navigateTo(k.screen)}
                className="p-3.5 rounded-2xl bg-surface border border-line flex items-center justify-between cursor-pointer hover:border-line"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-lime/20 text-navy font-bold flex items-center justify-center text-xs">
                    {k.step}
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-ink">{k.title}</h4>
                    <p className="text-[11px] text-muted">{k.desc}</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted" />
              </div>
            ))}
          </div>
        </div>

        <div className="pb-4">
          <Button variant="primary" fullWidth size="lg" onClick={() => navigateTo('emirates_id')}>
            Start Verification (Step 1)
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 4-7. KYC DOCUMENTS (Emirates ID, Licence, Vehicle Reg, Insurance)
   * ------------------------------------------------------------- */
  if (['emirates_id', 'driving_licence', 'vehicle_reg', 'insurance'].includes(currentScreen)) {
    const titles: Record<string, { title: string; desc: string; next: string }> = {
      emirates_id: {
        title: 'Emirates ID Verification',
        desc: 'Scan front and reverse of your official UAE Federal Identity card.',
        next: 'driving_licence',
      },
      driving_licence: {
        title: 'UAE Heavy Driving License',
        desc: 'Upload clear scan of Category 4 / Heavy Recovery license.',
        next: 'vehicle_reg',
      },
      vehicle_reg: {
        title: 'Vehicle Registration (Mulkiya)',
        desc: 'Official Dubai or Abu Dhabi commercial plate registration card.',
        next: 'insurance',
      },
      insurance: {
        title: 'Commercial Carrier Insurance',
        desc: 'Valid comprehensive goods-in-transit towing policy certificate.',
        next: 'kyc_status',
      },
    };

    const docConfig = titles[currentScreen];

    return (
      <div className="flex-1 flex flex-col justify-between p-6 bg-canvas text-ink">
        <div>
          <button
            onClick={() => navigateTo('kyc_intro')}
            className="p-1 -ml-1 text-muted hover:text-ink flex items-center gap-1 text-xs"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>KYC Overview</span>
          </button>
          <h2 className="text-xl font-bold text-ink mt-4">{docConfig.title}</h2>
          <p className="text-xs text-muted mt-1">{docConfig.desc}</p>

          <input
            aria-label="Document number (optional)"
            value={documentNumber}
            onChange={(e) => setDocumentNumber(e.target.value)}
            placeholder="Document number (optional)"
            className="mt-6 w-full bg-surface border border-line rounded-xl px-3 py-2 text-xs text-ink outline-none focus:border-navy"
          />

          {/* Upload Area */}
          <label className="mt-3 block border-2 border-dashed border-line bg-surface/50 rounded-3xl p-8 text-center space-y-3 cursor-pointer hover:border-navy transition-colors">
            <input
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              disabled={dispatchBusy}
              aria-label={`Upload ${DOCUMENT_LABELS[KYC_SCREEN_DOC[currentScreen]]}`}
              onChange={(e) => {
                void uploadKycDocument(KYC_SCREEN_DOC[currentScreen], e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <div className="w-12 h-12 rounded-2xl bg-lime/20 text-navy flex items-center justify-center mx-auto">
              {dispatchBusy ? <Upload className="w-6 h-6 animate-pulse" /> : <Camera className="w-6 h-6" />}
            </div>
            <div>
              <div className="text-xs font-bold text-ink">
                {dispatchBusy ? 'Uploading…' : 'Tap to Capture or Upload Document'}
              </div>
              <div className="text-[10px] text-muted mt-0.5">PDF, PNG, JPG, WebP or HEIC (max 10 MB)</div>
            </div>
          </label>

          {(() => {
            const doc = documents.find((d) => d.type === KYC_SCREEN_DOC[currentScreen]);
            if (!doc) {
              return (
                <div className="mt-4 p-3 rounded-xl bg-surface border border-line text-xs text-muted">
                  Not uploaded yet.
                </div>
              );
            }
            const tone =
              doc.status === 'approved' ? 'text-success' : doc.status === 'pending' ? 'text-navy' : 'text-danger';
            return (
              <div className={`mt-4 p-3 rounded-xl bg-surface border border-line flex items-center gap-2 text-xs font-medium ${tone}`}>
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  {doc.status === 'approved'
                    ? 'Approved by TowNow compliance.'
                    : doc.status === 'pending'
                      ? 'Uploaded — waiting for review by TowNow compliance.'
                      : `Not accepted${doc.rejectionReason ? `: ${doc.rejectionReason}` : ''}. Upload a new copy.`}
                </span>
              </div>
            );
          })()}
        </div>

        <div className="pb-4">
          <Button variant="primary" fullWidth size="lg" onClick={() => navigateTo(docConfig.next)}>
            Save & Continue to Next Step
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 8. KYC VERIFICATION STATUS
   * ------------------------------------------------------------- */
  if (currentScreen === 'kyc_status') {
    const kyc = driverProfile?.kycStatus ?? 'pending';
    const uploaded = documents.length;
    const look = {
      approved: { icon: ShieldCheck, tone: 'bg-success/10 border-success/30 text-success', title: 'Documents Verified!' },
      pending: { icon: Clock, tone: 'bg-lime/30 border-navy/30 text-navy', title: uploaded >= 4 ? 'Documents Under Review' : 'Documents Needed' },
      rejected: { icon: AlertTriangle, tone: 'bg-danger/10 border-danger/30 text-danger', title: 'Verification Not Approved' },
      suspended: { icon: AlertOctagon, tone: 'bg-danger/10 border-danger/30 text-danger', title: 'Account Suspended' },
    }[kyc];
    const Icon = look.icon;
    return (
      <div className="flex-1 flex flex-col justify-between p-6 bg-canvas text-ink text-center">
        <div className="pt-8">
          <div
            className={`w-16 h-16 rounded-3xl border ${look.tone} flex items-center justify-center mx-auto mb-4`}
          >
            <Icon className="w-9 h-9" />
          </div>
          <h2 className="text-2xl font-bold text-ink">{auth.user ? look.title : 'Sign in to see your status'}</h2>
          <p className="text-xs text-muted mt-1 max-w-xs mx-auto">
            {!auth.user
              ? 'Your verification status is shown after you sign in.'
              : kyc === 'approved'
                ? 'Your credentials were approved by the TowNow compliance team. You can go online.'
                : kyc === 'rejected'
                  ? driverProfile?.kycRejectionReason ?? 'Please update your documents.'
                  : kyc === 'suspended'
                    ? 'Contact TowNow support.'
                    : uploaded >= 4
                      ? 'The compliance team is reviewing your documents. You will be notified here.'
                      : `Upload all 4 documents to be reviewed (${uploaded}/4 uploaded).`}
          </p>

          {auth.user && (
            <div className="mt-6 p-4 rounded-2xl bg-surface border border-line text-left space-y-2 text-xs">
              {(Object.keys(DOCUMENT_LABELS) as DocumentType[]).map((type) => {
                const doc = documents.find((d) => d.type === type);
                return (
                  <div key={type} className="flex justify-between">
                    <span className="text-muted">{DOCUMENT_LABELS[type]}</span>
                    <span
                      className={
                        !doc
                          ? 'text-muted'
                          : doc.status === 'approved'
                            ? 'text-success'
                            : doc.status === 'pending'
                              ? 'text-navy'
                              : 'text-danger'
                      }
                    >
                      {!doc ? 'Not uploaded' : doc.status === 'pending' ? 'In review' : doc.status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="pb-4 space-y-2">
          {auth.user && kyc !== 'approved' && kyc !== 'suspended' && (
            <Button variant="outline" fullWidth size="md" onClick={() => navigateTo('kyc_intro')}>
              {kyc === 'rejected' ? 'Update Documents' : 'Upload Documents'}
            </Button>
          )}
          <Button
            variant="primary"
            fullWidth
            size="lg"
            onClick={() => navigateTo(auth.user ? 'driver_home' : 'login')}
          >
            {auth.user ? 'Enter Partner Dashboard' : 'Sign In'}
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 9. DRIVER HOME DASHBOARD (Prominent metrics + Online Toggle + Jobs)
   * ------------------------------------------------------------- */
  if (currentScreen === 'driver_home') {
    return (
      <div className="flex-1 flex flex-col bg-canvas text-ink">
        {/* Top Header */}
        <div className="p-4 border-b border-line flex items-center justify-between sticky top-0 bg-surface/90 backdrop-blur-md z-20">
          <div className="flex items-center gap-3">
            <Avatar name={partnerName} size="md" />
            <div>
              <div className="text-[10px] text-muted">Partner Shift</div>
              <h3 className="text-sm font-bold text-ink">{partnerName}</h3>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Notifications Bell */}
            <button
              onClick={() => navigateTo('notifications')}
              className="relative p-2 rounded-xl bg-surface border border-line text-ink/80 hover:text-ink"
              title="Notifications"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-lime text-navy font-bold text-[9px] w-4 h-4 rounded-full flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Online / Offline Status (opens shift control) */}
            <button
              onClick={() => navigateTo('online_toggle')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                isOnline
                  ? 'bg-success/10 border-success text-success'
                  : 'bg-surface border-line text-muted'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isOnline ? 'bg-success animate-ping' : 'bg-muted'
                }`}
              />
              <span>{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
            </button>
          </div>
        </div>

        {/* Scrollable Feed */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-20">
          {/* Prominent Daily Earnings Hero Card */}
          <div className="p-5 rounded-2xl bg-gradient-to-br from-surface via-canvas to-surface border border-line shadow-xl">
            <div className="flex items-center justify-between text-xs text-muted mb-1">
              <span>Today's Net Earnings</span>
              <button
                onClick={() => navigateTo('earnings')}
                className="text-navy font-semibold flex items-center gap-1"
              >
                <span>Settlement ledger</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="text-3xl font-black text-navy font-mono tracking-tight">
              {ledger ? formatAed(todayEntries.reduce((sum, e) => sum + e.amountFils, 0)) : '—'}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-line text-center">
              <div>
                <div className="text-base font-bold text-ink font-mono">{ledger ? todayEntries.length : '—'}</div>
                <div className="text-[10px] text-muted">Jobs Done</div>
              </div>
              <div className="border-x border-line">
                <div className="text-base font-bold text-navy font-mono flex items-center justify-center gap-0.5">
                  <Star className="w-3.5 h-3.5 fill-warning" />
                  <span>{driverProfile?.rating ? driverProfile.rating.toFixed(2) : 'New'}</span>
                </div>
                <div className="text-[10px] text-muted">Driver Rating</div>
              </div>
              <div>
                <div className="text-base font-bold text-success font-mono">{driverProfile?.acceptanceRate != null ? `${driverProfile.acceptanceRate}%` : '—'}</div>
                <div className="text-[10px] text-muted">Acceptance</div>
              </div>
            </div>
          </div>

          {/* Active Job Card (real assigned job) */}
          {currentJob ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted">
                  Current Assigned Mission
                </h3>
                <StatusBadge status={currentJob.status} />
              </div>

              <div
                onClick={() => navigateTo(resumeScreen(currentJob))}
                className="p-4 rounded-2xl bg-surface border border-navy/40 shadow-lg cursor-pointer hover:bg-canvas transition-all space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs font-bold text-navy font-mono">{currentJob.bookingNumber}</div>
                    <h4 className="text-sm font-bold text-ink mt-0.5">
                      {currentJob.vehicle.brand} {currentJob.vehicle.model}
                    </h4>
                    <p className="text-[11px] text-muted">
                      {currentJob.issue} · {currentJob.vehicle.plate}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-success font-mono">
                      {formatAed(currentJob.driverPayoutFils)}
                    </span>
                    <div className="text-[10px] text-muted">Your payout</div>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-lime" />
                    <span className="text-ink/80 truncate">Pickup: {currentJob.pickup.address}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-success" />
                    <span className="text-ink/80 truncate">Dropoff: {currentJob.dropoff.address}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-3.5 rounded-2xl bg-surface/60 border border-line text-center space-y-2">
              <div className="text-xs font-semibold text-ink/80">
                {!auth.user
                  ? 'Sign in to receive tow requests'
                  : isOnline
                  ? 'Waiting for tow requests near you…'
                  : 'You are offline'}
              </div>
              {offer ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => navigateTo('incoming_job')}
                  leftIcon={<Flame className="w-3.5 h-3.5" />}
                >
                  View Job Offer ({offerSecondsLeft}s)
                </Button>
              ) : (
                <p className="text-[11px] text-muted">
                  {isOnline
                    ? 'Keep the app open with location on — offers arrive automatically.'
                    : 'Go online to receive new job offers.'}
                </p>
              )}
            </div>
          )}
        </div>

        <DriverBottomNav activeTab={bottomNavTab} onChangeTab={handleBottomNavChange} hasActiveJob={!!currentJob} />
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 11. INCOMING JOB RADAR        <DriverBottomNav activeTab={bottomNavTab} onChangeTab={handleBottomNavChange} hasActiveJob={!!currentJob} />
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 11. INCOMING JOB RADAR (Countdown & Acceptance)
   * ------------------------------------------------------------- */
  if (currentScreen === 'incoming_job') {
    if (!offer) {
      return (
        <div className="flex-1 flex flex-col justify-center items-center p-6 bg-canvas text-ink text-center space-y-3">
          <Truck className="w-10 h-10 text-muted" />
          <h2 className="text-lg font-bold text-ink">No job offer right now</h2>
          <p className="text-xs text-muted max-w-xs">
            {isOnline
              ? 'Stay online — new tow requests near you appear here automatically.'
              : 'Go online to start receiving tow requests.'}
          </p>
          <Button variant="primary" size="md" onClick={() => navigateTo('driver_home')}>
            Back to Dashboard
          </Button>
        </div>
      );
    }
    return (
      <div className="flex-1 flex flex-col justify-between p-6 bg-canvas text-ink text-center">
        <div className="pt-4">
          <div className="w-16 h-16 rounded-3xl bg-lime/40 text-navy flex items-center justify-center mx-auto mb-3 animate-bounce">
            <Truck className="w-9 h-9" />
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-lime/40 text-navy text-xs font-bold border border-navy/30">
            <span className="w-2 h-2 rounded-full bg-lime animate-ping" />
            <span>NEW JOB DISPATCH</span>
          </div>
          <h2 className="text-2xl font-black text-ink mt-3">
            {formatAed(offer.driverPayoutFils)}
          </h2>
          <p className="text-xs text-muted">
            Your payout · {TOW_TYPE_LABELS[offer.towType]} · {(offer.tripDistanceMeters / 1000).toFixed(1)} km tow ·{' '}
            {(offer.distanceToPickupMeters / 1000).toFixed(1)} km to pickup
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-surface border border-line text-left space-y-3">
          <div className="flex justify-between items-center text-xs pb-2 border-b border-line">
            <span className="text-muted">Customer Vehicle</span>
            <span className="font-bold text-ink">
              {offer.vehicle.brand} {offer.vehicle.model} ({offer.vehicle.plate})
            </span>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-lime" />
              <span className="text-ink/80">Pickup: {offer.pickup.address}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span className="text-ink/80">Dropoff: {offer.dropoff.address}</span>
            </div>
          </div>
          <div className="text-right text-[11px] text-navy font-semibold tabular-nums">
            Auto-rejects in {offerSecondsLeft} seconds
          </div>
        </div>

        <div className="space-y-2 pb-4">
          <Button
            variant="primary"
            fullWidth
            size="xl"
            isLoading={dispatchBusy}
            onClick={() => void acceptCurrentOffer()}
          >
            ACCEPT JOB ({formatAed(offer.driverPayoutFils)})
          </Button>
          <Button
            variant="ghost"
            fullWidth
            size="md"
            disabled={dispatchBusy}
            onClick={() => void declineCurrentOffer()}
            className="text-muted"
          >
            Decline Job
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 12. JOB DETAILS & VEHICLE SPEC
   * ------------------------------------------------------------- */
  if (currentScreen === 'job_details') {
    if (!currentJob) return noActiveJob();
    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink">
        <div className="p-4 border-b border-line flex items-center justify-between sticky top-0 bg-surface/90 backdrop-blur-md z-10">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigateTo('driver_home')}
              className="p-1 text-muted hover:text-ink"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h3 className="text-sm font-bold text-ink">Job Spec: {currentJob.bookingNumber}</h3>
          </div>
          <StatusBadge status={currentJob.status} />
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="p-4 rounded-2xl bg-surface border border-line space-y-2.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted">Customer Name</span>
              <span className="font-semibold text-ink">{currentJob.customerFirstName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Vehicle</span>
              <span className="font-bold text-ink">{currentJob.vehicle.brand} {currentJob.vehicle.model} · {currentJob.vehicle.plate}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Issue</span>
              <span className="text-danger font-semibold">{currentJob.issue}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Pickup</span>
              <span className="text-ink text-right">{currentJob.pickup.address}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Drop-off</span>
              <span className="text-ink text-right">{currentJob.dropoff.address}</span>
            </div>
            {currentJob.notes && (
              <div className="pt-2 border-t border-line text-[11px] text-muted">
                <span className="font-semibold text-ink/80">Customer Note: </span>
                {currentJob.notes}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => showToast('Customer phone numbers are not shared in the app yet.', 'info')}
              leftIcon={<Phone className="w-3.5 h-3.5 text-success" />}
            >
              Call Customer
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => showToast('In-app chat is not available yet.', 'info')}
              leftIcon={<MessageSquare className="w-3.5 h-3.5 text-info" />}
            >
              Chat
            </Button>
          </div>
        </div>

        <div className="p-4 border-t border-line bg-surface/90">
          <Button
            variant="primary"
            fullWidth
            size="lg"
            onClick={() => navigateTo('navigation')}
            rightIcon={<Navigation className="w-4 h-4" />}
          >
            Launch Navigation
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 14. TURN-BY-TURN NAVIGATION SCREEN
   * ------------------------------------------------------------- */
  if (currentScreen === 'navigation') {
    if (!currentJob) return noActiveJob();
    return (
      <div className="flex-1 flex flex-col bg-canvas text-ink relative">
        <div className="absolute top-4 left-4 right-4 z-20 bg-surface/95 border border-line rounded-2xl p-3 shadow-2xl backdrop-blur-md flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 shrink-0 rounded-xl bg-lime text-navy flex items-center justify-center font-bold">
              <Navigation className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] text-navy font-bold uppercase">Head to pickup</div>
              <div className="text-xs font-bold text-ink truncate">{currentJob.pickup.address}</div>
            </div>
          </div>
          <a
            href={directionsUrl(currentJob.pickup)}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-[11px] font-semibold text-navy hover:text-navy"
          >
            Open in Maps
          </a>
        </div>

        <div className="flex-1 relative">
          <MapPanel
            pickup={toUiPlace('pickup', currentJob.pickup)}
            destination={toUiPlace('dropoff', currentJob.dropoff)}
            driver={myFix ? withLiveLocation({}, myFix) : undefined}
            towType={currentJob.towType}
            showRoute={true}
            interactive={true}
          />
        </div>

        <div className="p-4 bg-surface border-t border-line z-20 space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="text-muted">Customer: {currentJob.customerFirstName}</span>
            <span className="font-mono text-navy">{currentJob.bookingNumber}</span>
          </div>
          <Button
            variant="primary"
            fullWidth
            size="lg"
            isLoading={dispatchBusy}
            onClick={() => void runTripStep('arrived', 'arrived')}
            rightIcon={<Check className="w-4 h-4" />}
          >
            I Have Arrived at Scene
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 15. ARRIVED SCREEN
   * ------------------------------------------------------------- */
  if (currentScreen === 'arrived') {
    if (!currentJob) return noActiveJob();
    return (
      <div className="flex-1 flex flex-col justify-between p-6 bg-canvas text-ink text-center">
        <div className="pt-6">
          <div className="w-16 h-16 rounded-3xl bg-lime/30 border border-navy/30 text-navy flex items-center justify-center mx-auto mb-4">
            <MapPin className="w-9 h-9" />
          </div>
          <h2 className="text-xl font-bold text-ink">You Have Arrived at Scene</h2>
          <p className="text-xs text-muted mt-1 max-w-xs mx-auto">
            Turn on yellow clearance beacons and set up safety triangles before inspecting the vehicle.
          </p>

          <div className="mt-8 p-4 rounded-2xl bg-surface border border-line text-left space-y-2 text-xs">
            <div className="flex justify-between font-bold">
              <span className="text-muted">Customer:</span>
              <span className="text-ink">{currentJob.customerFirstName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Vehicle:</span>
              <span className="text-navy font-semibold">
                {currentJob.vehicle.brand} {currentJob.vehicle.model}
                {currentJob.vehicle.color ? ` (${currentJob.vehicle.color})` : ''}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Plate:</span>
              <span className="font-mono text-ink">{currentJob.vehicle.plate}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Issue:</span>
              <span className="text-danger">{currentJob.issue}</span>
            </div>
          </div>
        </div>

        <div className="pb-4 space-y-2">
          <Button
            variant="primary"
            fullWidth
            size="lg"
            onClick={() => navigateTo('vehicle_inspection')}
            rightIcon={<Camera className="w-4 h-4" />}
          >
            {currentJob.inspections.pickup === 'draft' ? 'Continue Pickup Inspection' : 'Start Pickup Inspection'}
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 16. VEHICLE INSPECTION (pickup or return — odometer, fuel, checklist, photos)
   * ------------------------------------------------------------- */
  if (currentScreen === 'vehicle_inspection') {
    if (!currentJob) return noActiveJob();
    if (currentJob.status !== 'driver_arrived' && currentJob.status !== 'in_transit') {
      return noActiveJob('Inspection opens on arrival');
    }
    const label = inspectionStage === 'pickup' ? 'Pickup' : 'Return';
    const onServer = (slot: string) => inspection?.photos.some((ph) => ph.slot === slot) ?? false;
    const serverExtras = inspection?.photos.filter((ph) => ph.slot === 'extra').length ?? 0;
    const canAddExtra = serverExtras + extraFiles.length < MAX_EXTRA_PHOTOS;
    const locked = !!inspection?.submittedAt;
    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink">
        <div className="p-4 border-b border-line flex items-center justify-between sticky top-0 bg-surface/90 z-10">
          <h3 className="text-sm font-bold text-ink">{label} Inspection</h3>
          <span className="text-xs text-navy font-semibold font-mono">{currentJob.bookingNumber}</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <p className="text-xs text-muted">
            {inspectionStage === 'pickup'
              ? 'Record the vehicle as you find it, before loading. This protects you and the customer.'
              : 'Record the vehicle at the destination before handing it over.'}
          </p>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted space-y-1">
              <span>Odometer (km)</span>
              <input
                aria-label="Odometer reading"
                inputMode="numeric"
                value={odometer}
                disabled={locked}
                onChange={(e) => setOdometer(e.target.value.replace(/\D/g, ''))}
                className="w-full bg-surface border border-line rounded-xl px-3 py-2 text-sm text-ink outline-none focus:border-navy"
              />
            </label>
            <label className="text-xs text-muted space-y-1">
              <span>Fuel level</span>
              <select
                aria-label="Fuel level"
                value={fuelLevel}
                disabled={locked}
                onChange={(e) => setFuelLevel(e.target.value as FuelLevel)}
                className="w-full bg-surface border border-line rounded-xl px-3 py-2 text-sm text-ink outline-none focus:border-navy"
              >
                <option value="empty">Empty</option>
                <option value="quarter">1/4</option>
                <option value="half">1/2</option>
                <option value="three_quarters">3/4</option>
                <option value="full">Full</option>
              </select>
            </label>
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted">Condition checklist</div>
            <div className="grid grid-cols-2 gap-1.5">
              {CHECKLIST_ITEMS.map((item) => (
                <button
                  key={item}
                  type="button"
                  disabled={locked}
                  aria-pressed={checklist[item] === 'damaged'}
                  onClick={() =>
                    setChecklist((c) => ({ ...c, [item]: c[item] === 'ok' ? 'damaged' : 'ok' }))
                  }
                  className={`px-3 py-2 rounded-xl border text-xs flex justify-between capitalize ${
                    checklist[item] === 'ok'
                      ? 'border-line bg-surface text-ink/80'
                      : 'border-danger/30 bg-danger/10 text-danger'
                  }`}
                >
                  <span>{item}</span>
                  <span className="font-semibold">{checklist[item] === 'ok' ? 'OK' : 'Damaged'}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted">Photos (front, back, left, right required)</div>
            <div className="grid grid-cols-2 gap-2">
              {REQUIRED_SLOTS.map((slot) => {
                const picked = slotFiles[slot as keyof typeof slotFiles];
                const done = !!picked || onServer(slot);
                return (
                  <label
                    key={slot}
                    className={`h-24 rounded-xl border p-3 flex flex-col justify-between capitalize ${
                      locked ? '' : 'cursor-pointer hover:border-navy'
                    } ${done ? 'border-success/30 bg-surface' : 'border-dashed border-line bg-surface/40'}`}
                  >
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      disabled={locked}
                      aria-label={`${slot} photo`}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) setSlotFiles((f) => ({ ...f, [slot]: file }));
                        e.target.value = '';
                      }}
                    />
                    <span className="text-[11px] font-semibold text-ink">{slot}</span>
                    <span
                      className={`flex items-center gap-1 text-[10px] font-medium ${done ? 'text-success' : 'text-navy'}`}
                    >
                      {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />}
                      {picked ? 'Ready to upload' : onServer(slot) ? 'Uploaded (tap to retake)' : 'Tap to capture'}
                    </span>
                  </label>
                );
              })}
              {canAddExtra && !locked && (
                <label className="h-24 rounded-xl border border-dashed border-line bg-surface/40 flex flex-col items-center justify-center text-muted hover:text-ink cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    aria-label="Extra photo"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) setExtraFiles((f) => [...f, file]);
                      e.target.value = '';
                    }}
                  />
                  <Camera className="w-5 h-5 mb-1 text-navy" />
                  <span className="text-[11px]">
                    Add extra photo ({serverExtras + extraFiles.length}/{MAX_EXTRA_PHOTOS})
                  </span>
                </label>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1.5" htmlFor="inspection-notes">
              Damage notes (optional)
            </label>
            <textarea
              id="inspection-notes"
              value={inspectionNotes}
              disabled={locked}
              maxLength={1000}
              onChange={(e) => setInspectionNotes(e.target.value)}
              className="w-full bg-surface border border-line rounded-xl p-3 text-xs text-ink outline-none focus:border-navy min-h-[70px]"
            />
          </div>
        </div>

        <div className="p-4 border-t border-line bg-surface/90">
          {locked ? (
            <Button
              variant="primary"
              fullWidth
              size="lg"
              onClick={() => navigateTo(inspectionStage === 'pickup' ? 'vehicle_loaded' : 'complete_job')}
              rightIcon={<ArrowRight className="w-4 h-4" />}
            >
              {label} inspection submitted — continue
            </Button>
          ) : (
            <Button
              variant="primary"
              fullWidth
              size="lg"
              isLoading={dispatchBusy}
              onClick={() => void submitCurrentInspection()}
              rightIcon={<ArrowRight className="w-4 h-4" />}
            >
              Submit {label} Inspection
            </Button>
          )}
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 17. VEHICLE LOADED — START TOW
   * ------------------------------------------------------------- */
  if (currentScreen === 'vehicle_loaded') {
    if (!currentJob) return noActiveJob();
    return (
      <div className="flex-1 flex flex-col justify-between p-6 bg-canvas text-ink text-center">
        <div className="pt-6">
          <div className="w-16 h-16 rounded-3xl bg-info/10 border border-info/30 text-info flex items-center justify-center mx-auto mb-4">
            <Truck className="w-9 h-9" />
          </div>
          <h2 className="text-xl font-bold text-ink">Load & Secure the Vehicle</h2>
          <p className="text-xs text-muted mt-1 max-w-xs mx-auto">
            Strap all four wheels and hook the safety chains, then start the tow. The customer is notified.
          </p>

          <div className="mt-8 p-4 rounded-2xl bg-surface border border-line text-left space-y-2.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted">Pickup inspection</span>
              <span className={currentJob.inspections.pickup === 'submitted' ? 'text-success' : 'text-navy'}>
                {currentJob.inspections.pickup === 'submitted' ? 'Submitted' : 'Not submitted'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Destination</span>
              <span className="text-ink text-right">{currentJob.dropoff.address}</span>
            </div>
          </div>
        </div>

        <div className="pb-4 space-y-2">
          {currentJob.inspections.pickup !== 'submitted' && (
            <Button variant="outline" fullWidth size="md" onClick={() => navigateTo('vehicle_inspection')}>
              Complete Pickup Inspection
            </Button>
          )}
          <Button
            variant="primary"
            fullWidth
            size="lg"
            isLoading={dispatchBusy}
            disabled={currentJob.inspections.pickup !== 'submitted'}
            onClick={() => void runTripStep('start-tow', 'in_transit')}
            rightIcon={<Navigation className="w-4 h-4" />}
          >
            Start Tow (Head to Destination)
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 18. IN TRANSIT SCREEN
   * ------------------------------------------------------------- */
  if (currentScreen === 'in_transit') {
    if (!currentJob) return noActiveJob();
    return (
      <div className="flex-1 flex flex-col bg-canvas text-ink relative">
        <div className="absolute top-4 left-4 right-4 z-20 bg-surface/95 border border-line rounded-2xl p-3 shadow-2xl backdrop-blur-md flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] text-navy font-bold uppercase">Tow in progress</div>
            <div className="text-xs font-bold text-ink truncate">{currentJob.dropoff.address}</div>
          </div>
          <a
            href={directionsUrl(currentJob.dropoff)}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-[11px] font-semibold text-navy hover:text-navy"
          >
            Open in Maps
          </a>
        </div>

        <div className="flex-1 relative">
          <MapPanel
            pickup={toUiPlace('pickup', currentJob.pickup)}
            destination={toUiPlace('dropoff', currentJob.dropoff)}
            driver={myFix ? withLiveLocation({}, myFix) : undefined}
            towType={currentJob.towType}
            showRoute={true}
            interactive={true}
          />
        </div>

        <div className="p-4 bg-surface border-t border-line z-20">
          <Button
            variant="primary"
            fullWidth
            size="lg"
            onClick={() => navigateTo('vehicle_inspection')}
            rightIcon={<Camera className="w-4 h-4" />}
          >
            Arrived — Start Return Inspection
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 19. COMPLETE TOW
   * ------------------------------------------------------------- */
  if (currentScreen === 'complete_job') {
    if (completedJob && !currentJob) {
      return (
        <div className="flex-1 flex flex-col justify-between p-6 bg-canvas text-ink text-center">
          <div className="pt-6">
            <div className="w-16 h-16 rounded-3xl bg-success/10 border border-success/30 text-success flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-9 h-9" />
            </div>
            <h2 className="text-xl font-bold text-ink">Tow Completed</h2>
            <p className="text-xs text-muted mt-1 max-w-xs mx-auto">
              {completedJob.bookingNumber} delivered to {completedJob.dropoff.address}.
            </p>
            <div className="mt-8 p-4 rounded-2xl bg-surface border border-line text-left space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted">Customer fare</span>
                <span className="font-mono text-ink font-bold">{formatAed(completedJob.fareTotalFils)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Your payout</span>
                <span className="font-mono text-success font-bold text-sm">
                  {formatAed(completedJob.driverPayoutFils)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Payment</span>
                <span className="text-ink text-right">
                  {completedJob.paymentMethod === 'cash'
                    ? cashRecorded
                      ? 'Cash collected ✓'
                      : `Collect ${formatAed(completedJob.fareTotalFils)} in cash`
                    : 'Card — charged automatically, do not collect cash'}
                </span>
              </div>
            </div>
          </div>
          <div className="pb-4 space-y-2">
            {completedJob.paymentMethod === 'cash' && !cashRecorded && (
              <Button variant="outline" fullWidth size="md" isLoading={dispatchBusy} onClick={() => void confirmCash()}>
                Confirm {formatAed(completedJob.fareTotalFils)} Cash Collected
              </Button>
            )}
            <Button
              variant="primary"
              fullWidth
              size="lg"
              onClick={() => {
                setCompletedJob(null);
                setCashRecorded(false);
                navigateTo('driver_home');
              }}
            >
              Back to Partner Dashboard
            </Button>
          </div>
        </div>
      );
    }
    if (!currentJob) return noActiveJob();
    const ready = currentJob.status === 'in_transit' && currentJob.inspections.return === 'submitted';
    return (
      <div className="flex-1 flex flex-col justify-between p-6 bg-canvas text-ink text-center">
        <div className="pt-6">
          <div className="w-16 h-16 rounded-3xl bg-success/10 border border-success/30 text-success flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-9 h-9" />
          </div>
          <h2 className="text-xl font-bold text-ink">Complete Tow & Hand Over</h2>
          <p className="text-xs text-muted mt-1 max-w-xs mx-auto">
            Unload the vehicle at {currentJob.dropoff.address}, then complete the job.
          </p>
          <div className="mt-8 p-4 rounded-2xl bg-surface border border-line text-left space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted">Return inspection</span>
              <span className={currentJob.inspections.return === 'submitted' ? 'text-success' : 'text-navy'}>
                {currentJob.inspections.return === 'submitted' ? 'Submitted' : 'Not submitted'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Your payout</span>
              <span className="font-mono text-success font-bold">{formatAed(currentJob.driverPayoutFils)}</span>
            </div>
          </div>
        </div>
        <div className="pb-4 space-y-2">
          {!ready && (
            <Button variant="outline" fullWidth size="md" onClick={() => navigateTo('vehicle_inspection')}>
              Complete Return Inspection
            </Button>
          )}
          <Button
            variant="primary"
            fullWidth
            size="lg"
            isLoading={dispatchBusy}
            disabled={!ready}
            onClick={() => void runTripStep('complete', 'complete_job')}
          >
            Complete Tow
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 20. CASH COLLECTION / DIGITAL CONFIRMATION
   * ------------------------------------------------------------- */
  if (currentScreen === 'cash_collection') {
    if (!completedJob) return noActiveJob('No completed job');
    const cash = completedJob.paymentMethod === 'cash';
    const owed = completedJob.fareTotalFils - completedJob.driverPayoutFils; // commission + VAT
    return (
      <div className="flex-1 flex flex-col justify-between p-6 bg-canvas text-ink text-center">
        <div className="pt-4">
          <div className="w-14 h-14 rounded-2xl bg-lime/30 border border-navy/30 text-navy flex items-center justify-center mx-auto mb-3">
            <DollarSign className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-ink">Trip settlement</h2>
          <p className="text-xs text-muted mt-0.5">{completedJob.bookingNumber} · from the server, after the 20% TowNow commission</p>

          <div className="mt-6 p-4 rounded-2xl bg-surface border border-line text-left space-y-2.5 text-xs">
            <div className="flex justify-between text-muted">
              <span>Customer total (incl. VAT)</span>
              <span className="font-mono">{formatAed(completedJob.fareTotalFils)}</span>
            </div>
            <div className="flex justify-between text-muted">
              <span>Your earning</span>
              <span className="font-mono text-success">{formatAed(completedJob.driverPayoutFils)}</span>
            </div>
            <div className="flex justify-between font-bold text-ink pt-2 border-t border-line text-sm">
              <span>{cash ? 'You owe TowNow (commission + VAT)' : 'TowNow owes you'}</span>
              <span className={`font-mono text-base ${cash ? 'text-danger' : 'text-success'}`}>
                {formatAed(cash ? owed : completedJob.driverPayoutFils)}
              </span>
            </div>
          </div>
        </div>

        <div className="pb-4 space-y-2">
          <Button variant="primary" fullWidth size="lg" onClick={() => navigateTo('driver_home')}>
            Back to Partner Dashboard
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 21. EARNINGS SCREEN
   * ------------------------------------------------------------- */
  if (currentScreen === 'earnings') {
    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink">
        <div className="p-4 border-b border-line sticky top-0 bg-surface/90 z-10 flex justify-between items-center">
          <h2 className="text-base font-bold text-ink">Partner Earnings</h2>
          <span className="text-xs text-muted font-mono">Settlement ledger</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-20">
          <div className="p-5 rounded-2xl bg-surface border border-line text-center">
            <div className="text-xs text-muted">Settlement Balance</div>
            <div
              className={`text-3xl font-black font-mono mt-1 ${
                ledger && ledger.balanceFils < 0 ? 'text-danger' : 'text-navy'
              }`}
            >
              {ledger ? formatAed(Math.abs(ledger.balanceFils)) : auth.user ? 'Loading…' : 'Sign in'}
            </div>
            <p className="text-[11px] text-muted mt-1">
              {!ledger
                ? 'Your earnings after the 20% TowNow commission.'
                : ledger.balanceFils >= 0
                  ? `TowNow owes you · ${ledger.entries.length} ledger entries · payouts are arranged by TowNow`
                  : 'You owe TowNow (commission + VAT on cash jobs you collected)'}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-surface/60 border border-line space-y-2 text-xs">
            <h4 className="font-bold text-ink uppercase tracking-wider text-[11px]">Ledger summary</h4>
            {([
              [`Completed tows (${tripEntries.length})`, 'trip_earning'],
              ['Cash collected from customers', 'cash_collected'],
              ['Paid to TowNow', 'remittance'],
              ['Paid out by TowNow', 'payout'],
            ] as const).map(([label, type]) => (
              <div key={type} className="flex justify-between text-ink/80">
                <span>{label}</span>
                <span className="font-mono">
                  {ledger ? formatAed(ledger.entries.filter((e) => e.type === type).reduce((sum, e) => sum + e.amountFils, 0)) : '—'}
                </span>
              </div>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            fullWidth
            onClick={() => navigateTo('earnings_details')}
          >
            View All Ledger Entries
          </Button>
        </div>

        <DriverBottomNav activeTab={bottomNavTab} onChangeTab={handleBottomNavChange} hasActiveJob={!!currentJob} />
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 22. EARNINGS DETAILS SCREEN
   * ------------------------------------------------------------- */
  if (currentScreen === 'earnings_details') {
    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink p-4">
        <div className="flex items-center gap-2 pb-3 border-b border-line">
          <button
            onClick={() => navigateTo('earnings')}
            className="p-1 text-muted hover:text-ink"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h3 className="text-sm font-bold text-ink">Settlement Ledger</h3>
        </div>

        <div className="flex-1 overflow-y-auto py-4 space-y-3">
          <p className="text-[11px] text-muted">
            Bank payouts are not set up in the app yet; TowNow arranges settlements with you directly.
          </p>
          {(ledger?.entries ?? []).length === 0 ? (
            <EmptyState title="No ledger entries yet" description="Completed tows and settlements appear here." />
          ) : ledger!.entries.map((e) => (
            <div key={e.id} className="p-3 rounded-2xl bg-surface border border-line flex justify-between text-xs">
              <div>
                <div className="font-semibold text-ink">{LEDGER_LABELS[e.type]}</div>
                <div className="text-[10px] text-muted">
                  {String(e.details.bookingNumber ?? '')} {new Date(e.createdAt).toLocaleString('en-GB')}
                </div>
              </div>
              <span className={`font-mono font-bold ${e.amountFils < 0 ? 'text-danger' : 'text-success'}`}>{formatAed(e.amountFils)}</span>
            </div>
          ))}
        </div>

        <Button variant="primary" fullWidth size="lg" onClick={() => navigateTo('earnings')}>
          Back to Earnings
        </Button>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 23. JOB HISTORY SCREEN
   * ------------------------------------------------------------- */
  if (currentScreen === 'job_history') {
    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink">
        <div className="p-4 border-b border-line sticky top-0 bg-surface/90 z-10">
          <h2 className="text-base font-bold text-ink">Completed Missions History</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 pb-20">
          {!auth.user ? (
            <EmptyState title="Sign in to see your jobs" description="Completed tows appear here with your earnings." />
          ) : !ledger ? (
            <Skeleton className="h-16 w-full rounded-2xl" />
          ) : tripEntries.length === 0 ? (
            <EmptyState title="No completed jobs yet" description="Completed tows appear here with your earnings." />
          ) : tripEntries.map((e) => (
            <div key={e.id} className="p-3.5 rounded-2xl bg-surface border border-line space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="font-mono font-bold text-navy">{String(e.details.bookingNumber ?? 'Tow')}</span>
                <span className="text-muted">{new Date(e.createdAt).toLocaleString('en-GB')}</span>
              </div>
              <div className="flex justify-between text-ink/80">
                <span>Your earning (after 20% commission)</span>
                <span className="font-mono text-success font-bold">{formatAed(e.amountFils)}</span>
              </div>
            </div>
          ))}
        </div>

        <DriverBottomNav activeTab={bottomNavTab} onChangeTab={handleBottomNavChange} hasActiveJob={!!currentJob} />
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 24. RATINGS SCREEN
   * ------------------------------------------------------------- */
  if (currentScreen === 'ratings') {
    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink p-4">
        <div className="flex items-center gap-2 pb-3 border-b border-line">
          <button
            onClick={() => navigateTo('driver_home')}
            className="p-1 text-muted hover:text-ink"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h3 className="text-sm font-bold text-ink">Customer Reviews & Stars</h3>
        </div>

        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          <div className="p-4 rounded-2xl bg-surface border border-line text-center">
            <div className="text-4xl font-black text-navy font-mono">
              {driverProfile?.rating ? driverProfile.rating.toFixed(2) : 'New'}
            </div>
            <div className="flex justify-center gap-1 my-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <Star
                  key={s}
                  className={`w-4 h-4 ${s <= Math.round(driverProfile?.rating ?? 0) ? 'fill-warning text-warning' : 'text-muted'}`}
                />
              ))}
            </div>
            <p className="text-xs text-muted">
              {driverProfile ? `${driverProfile.totalTrips} completed tows · average of customer ratings` : 'Sign in to see your rating'}
            </p>
          </div>
        </div>

        <Button variant="primary" fullWidth size="lg" onClick={() => navigateTo('driver_home')}>
          Back to Dashboard
        </Button>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 25-28. PROFILE, DOCUMENTS & SUPPORT
   * ------------------------------------------------------------- */
  if (currentScreen === 'profile' || currentScreen === 'documents' || currentScreen === 'support') {
    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink">
        <div className="p-4 border-b border-line sticky top-0 bg-surface/90 z-10">
          <h2 className="text-base font-bold text-ink">Partner Profile & Compliance</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-20">
          {auth.user ? (
            <>
              <div className="p-4 rounded-2xl bg-surface border border-line space-y-3">
                <div className="flex items-center gap-3">
                  <Avatar name={partnerName} size="lg" />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-ink truncate">{partnerName}</h3>
                    <p className="text-xs text-muted font-mono">{displayPhone(formatLocal(auth.user.phone))}</p>
                    <p
                      className={`text-[11px] font-semibold ${
                        driverProfile?.kycStatus === 'approved' ? 'text-success' : 'text-navy'
                      }`}
                    >
                      {driverProfile ? KYC_LABELS[driverProfile.kycStatus] : 'Loading profile…'}
                      {driverProfile && ` · ${driverProfile.experienceYears} yrs experience`}
                    </p>
                  </div>
                  {!isEditingProfile && (
                    <button
                      onClick={startEditProfile}
                      className="text-xs text-navy font-semibold hover:underline shrink-0"
                    >
                      Edit
                    </button>
                  )}
                </div>

                {isEditingProfile && (
                  <form
                    className="space-y-3 pt-3 border-t border-line"
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveProfile();
                    }}
                  >
                    <Input
                      label="Full Name"
                      id="driver-full-name"
                      placeholder="e.g. Tariq Al-Mansouri"
                      value={editName}
                      maxLength={120}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                    <Input
                      label="Years of Towing Experience"
                      id="driver-experience"
                      inputMode="numeric"
                      value={editExperience}
                      maxLength={2}
                      onChange={(e) => setEditExperience(e.target.value.replace(/\D/g, ''))}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Button type="button" variant="secondary" size="md" onClick={() => setIsEditingProfile(false)}>
                        Cancel
                      </Button>
                      <Button type="submit" variant="primary" size="md" isLoading={savingProfile}>
                        Save
                      </Button>
                    </div>
                  </form>
                )}
                {profileError && <p className="text-xs text-danger font-medium">{profileError}</p>}
              </div>

              <div className="p-4 rounded-2xl bg-surface border border-line space-y-2 text-xs">
                <h4 className="text-xs font-bold text-ink/80 uppercase tracking-wider">
                  My Tow Trucks
                </h4>
                {driverProfile && driverProfile.towTrucks.length === 0 && (
                  <p className="text-[11px] text-muted">
                    No tow truck registered yet. Add your Mulkiya details during onboarding.
                  </p>
                )}
                {driverProfile?.towTrucks.map((truck) => (
                  <div key={truck.id} className="flex items-center justify-between gap-2 py-1">
                    <div className="min-w-0">
                      <div className="font-semibold text-ink truncate">{truck.model}</div>
                      <div className="text-[11px] text-muted">
                        {TOW_TYPE_LABELS[truck.towType]} · {truck.year}
                        {!truck.isActive && ' · Inactive'}
                      </div>
                    </div>
                    <span className="font-mono font-bold text-ink bg-canvas px-2 py-0.5 rounded border border-line shrink-0">
                      {truck.plateEmirate} {truck.plateCode} {truck.plateNumber}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="p-4 rounded-2xl bg-surface border border-line flex items-center gap-3">
              <Avatar name="Partner" size="lg" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-ink">
                  {auth.status === 'checking' ? 'Checking your session…' : 'You are not signed in'}
                </h3>
                <p className="text-[11px] text-muted">
                  Sign in with your registered mobile number to manage your partner profile.
                </p>
              </div>
              {auth.status === 'signedOut' && (
                <Button variant="primary" size="sm" onClick={() => navigateTo('login')}>
                  Sign In
                </Button>
              )}
            </div>
          )}

          <div className="p-2 rounded-2xl bg-surface border border-line divide-y divide-line text-xs">
            {[
              { label: 'KYC Document Archive', action: () => navigateTo('kyc_status') },
              { label: 'Performance & Reviews', action: () => navigateTo('ratings') },
              { label: 'Shift History & Missions', action: () => navigateTo('job_history') },
              { label: 'Settlement Ledger', action: () => navigateTo('earnings_details') },
              ...(SUPPORT_PHONE
                ? [{ label: `Call TowNow support (${SUPPORT_PHONE})`, action: () => (window.location.href = `tel:${SUPPORT_PHONE}`) }]
                : []),
              { label: 'Emergency (Police) 999', action: () => (window.location.href = 'tel:999') },
            ].map((item, idx) => (
              <button
                key={idx}
                onClick={item.action}
                className="w-full flex items-center justify-between p-3 text-ink/80 hover:text-ink hover:bg-canvas transition-colors text-left"
              >
                <span>{item.label}</span>
                <ChevronRight className="w-4 h-4 text-muted" />
              </button>
            ))}
          </div>

          {auth.user && (
            <Button
              variant="ghost"
              fullWidth
              size="md"
              onClick={signOut}
              className="text-danger hover:text-danger"
            >
              End Shift & Log Out
            </Button>
          )}
        </div>

        <DriverBottomNav activeTab={bottomNavTab} onChangeTab={handleBottomNavChange} hasActiveJob={!!currentJob} />
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 10. ONLINE / OFFLINE SHIFT CONTROL
   * ------------------------------------------------------------- */
  if (currentScreen === 'online_toggle') {
    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink">
        <div className="p-4 border-b border-line flex items-center gap-2 sticky top-0 bg-surface/90 backdrop-blur-md z-10">
          <button
            onClick={() => navigateTo('driver_home')}
            className="p-1 text-muted hover:text-ink"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h3 className="text-sm font-bold text-ink">Shift Status</h3>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-center">
          <button
            onClick={() => void toggleAvailability()}
            disabled={dispatchBusy || availability === 'busy' || availability === 'en_route'}
            aria-pressed={isOnline}
            aria-label={isOnline ? 'Go offline' : 'Go online'}
            className={`w-36 h-36 rounded-full mx-auto flex flex-col items-center justify-center gap-1 border-4 transition-all ${
              isOnline
                ? 'bg-success/10 border-success text-success shadow-2xl shadow-success/10'
                : 'bg-surface border-line text-muted'
            }`}
          >
            <Power className="w-10 h-10" />
            <span className="text-sm font-black tracking-wider">{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
          </button>

          <div className="space-y-1">
            <h2 className="text-lg font-bold text-ink">
              {availability === 'busy' || availability === 'en_route'
                ? 'You are on a job'
                : isOnline
                ? 'You are receiving job offers'
                : 'You are not receiving jobs'}
            </h2>
            <p className="text-xs text-muted max-w-xs mx-auto">
              {isOnline
                ? 'Tap to go offline. Your current assigned job stays with you.'
                : 'Tap to go online and start receiving nearby towing requests.'}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-surface border border-line text-left space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted">GPS Position</span>
              <span className="font-semibold text-ink">{myFix ? `${myFix.lat.toFixed(4)}, ${myFix.lng.toFixed(4)}` : 'Not shared'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Jobs Completed Today</span>
              <span className="font-mono text-ink">{ledger ? todayEntries.length : '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Earnings Today</span>
              <span className="font-mono font-bold text-navy">
                {ledger ? formatAed(todayEntries.reduce((sum, e) => sum + e.amountFils, 0)) : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Acceptance Rate</span>
              <span className="font-mono text-success">{driverProfile?.acceptanceRate != null ? `${driverProfile.acceptanceRate}%` : '—'}</span>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-line bg-surface/90">
          <Button variant="primary" fullWidth size="lg" onClick={() => navigateTo('driver_home')}>
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 13. ACCEPT JOB / DISPATCH CONFIRMATION
   * ------------------------------------------------------------- */
  if (currentScreen === 'accept_job') {
    if (!currentJob) {
      return (
        <div className="flex-1 flex flex-col justify-center items-center p-6 bg-canvas text-ink text-center space-y-3">
          <CheckCircle2 className="w-10 h-10 text-muted" />
          <h2 className="text-lg font-bold text-ink">No active job</h2>
          <Button variant="primary" size="md" onClick={() => navigateTo('driver_home')}>
            Back to Dashboard
          </Button>
        </div>
      );
    }
    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink p-4">
        <div className="flex items-center justify-between pb-2 border-b border-line">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-success" />
            <h3 className="text-sm font-bold text-ink">Job Accepted</h3>
          </div>
          <span className="text-xs font-mono font-bold text-navy">{currentJob.bookingNumber}</span>
        </div>

        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          <div className="p-4 rounded-2xl bg-surface border border-line text-center">
            <div className="text-[11px] text-muted uppercase font-semibold">Your Payout</div>
            <div className="text-2xl font-black text-navy font-mono mt-0.5">
              {formatAed(currentJob.driverPayoutFils)}
            </div>
            <div className="text-[11px] text-muted">
              {TOW_TYPE_LABELS[currentJob.towType]} · {(currentJob.tripDistanceMeters / 1000).toFixed(1)} km tow ·
              customer pays {formatAed(currentJob.fareTotalFils)}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-surface border border-line space-y-2.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted">Vehicle</span>
              <span className="font-bold text-ink">
                {currentJob.vehicle.brand} {currentJob.vehicle.model} ({currentJob.vehicle.plate})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Customer</span>
              <span className="font-semibold text-ink">{currentJob.customerFirstName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Issue</span>
              <span className="text-danger font-semibold">{currentJob.issue}</span>
            </div>
            <div className="pt-2 border-t border-line space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-lime shrink-0" />
                <span className="text-ink/80">Pickup: {currentJob.pickup.address}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-success shrink-0" />
                <span className="text-ink/80">Dropoff: {currentJob.dropoff.address}</span>
              </div>
            </div>
            {currentJob.notes && (
              <div className="pt-2 border-t border-line text-[11px] text-muted">
                <span className="font-semibold text-ink/80">Customer Note: </span>
                {currentJob.notes}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => showToast('Customer phone numbers are not shared in the app yet.', 'info')}
              leftIcon={<Phone className="w-3.5 h-3.5 text-success" />}
            >
              Call Customer
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => window.open(directionsUrl(currentJob.pickup), '_blank', 'noopener')}
              leftIcon={<Navigation className="w-3.5 h-3.5 text-info" />}
            >
              Open in Maps
            </Button>
          </div>
        </div>

        <div className="space-y-2 pb-2">
          <Button
            variant="primary"
            fullWidth
            size="lg"
            isLoading={dispatchBusy}
            onClick={() => void beginEnRoute()}
            rightIcon={<Navigation className="w-4 h-4" />}
          >
            {currentJob.status === 'driver_arriving' ? 'Continue Navigation' : 'Start Navigation to Pickup'}
          </Button>
          <Button variant="ghost" fullWidth size="md" onClick={() => navigateTo('driver_home')}>
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 25. DRIVER NOTIFICATIONS
   * ------------------------------------------------------------- */
  if (currentScreen === 'notifications') {
    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink">
        <div className="p-4 border-b border-line sticky top-0 bg-surface/90 backdrop-blur-md z-10 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigateTo('driver_home')}
              className="p-1 text-muted hover:text-ink"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h2 className="text-base font-bold text-ink">Notifications</h2>
          </div>
          <button
            onClick={() =>
              markAllRead(auth.client)
                .then(() => {
                  setInbox((prev) => prev && { ...prev, unread: 0, items: prev.items.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) });
                  showToast('All notifications marked as read', 'success');
                })
                .catch(() => showToast('Could not update notifications. Check your connection.', 'error'))
            }
            disabled={unreadCount === 0}
            className="text-xs text-navy font-medium disabled:text-muted"
          >
            Mark all read
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2.5 pb-20">
          {!auth.user ? (
            <EmptyState title="Sign in to see notifications" description="Job offers, trip updates and KYC results appear here." />
          ) : !inbox ? (
            <Skeleton className="h-16 w-full rounded-2xl" />
          ) : inbox.items.length === 0 ? (
            <EmptyState title="No notifications yet" description="Job offers, trip updates and KYC results appear here." />
          ) : inbox.items.map((n) => (
            <div
              key={n.id}
              onClick={() => {
                const screen = n.type === 'offer.new' ? 'incoming_job' : n.type.startsWith('kyc.') ? 'kyc_status' : null;
                if (screen === 'incoming_job' && !offer) return showToast('This offer is no longer available', 'info');
                if (screen) navigateTo(screen);
              }}
              className={`p-3.5 rounded-2xl border transition-colors cursor-pointer hover:border-line ${
                !n.readAt ? 'bg-surface border-navy/40' : 'bg-surface/50 border-line'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-xs font-bold text-ink flex items-center gap-1.5">
                  {!n.readAt && <span className="w-1.5 h-1.5 rounded-full bg-lime shrink-0" />}
                  {n.title}
                </h4>
                <span className="text-[10px] text-muted shrink-0">{timeAgo(n.createdAt)}</span>
              </div>
              <p className="text-[11px] text-muted mt-1">{n.body}</p>
            </div>
          ))}
        </div>

        <DriverBottomNav activeTab={bottomNavTab} onChangeTab={handleBottomNavChange} hasActiveJob={!!currentJob} />
      </div>
    );
  }

  // Fallback
  return (
    <div className="p-6 text-center text-muted">
      <p>Driver view: {currentScreen}</p>
      <Button onClick={() => navigateTo('driver_home')} className="mt-4">
        Return to Partner Home
      </Button>
    </div>
  );
};
