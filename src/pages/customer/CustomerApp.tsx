import React, { useState } from 'react';
import {
  MapPin,
  Search,
  Navigation,
  Car,
  Bike,
  Plus,
  Shield,
  CreditCard,
  Phone,
  MessageSquare,
  AlertOctagon,
  ArrowRight,
  ArrowLeft,
  Clock,
  CheckCircle2,
  Share2,
  FileText,
  Star,
  ChevronRight,
  ChevronLeft,
  Sliders,
  DollarSign,
  AlertTriangle,
  Flame,
  Zap,
  Radio,
  Download,
  Info,
  Calendar,
  Truck,
  RotateCcw,
  ShieldCheck,
  Send,
} from 'lucide-react';
import {
  CustomerVehicle,
  Booking,
  LocationItem,
  TowType,
  VehicleIssue,
  PaymentMethod,
  Emirate,
} from '../../types';
import {
  MOCK_LOCATIONS,
  ASSETS,
} from '../../data/mockData';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Select } from '../../components/common/Select';
import { Tabs } from '../../components/common/Tabs';
import { EmptyState } from '../../components/common/EmptyState';
import { Badge } from '../../components/common/Badge';
import { StatusBadge } from '../../components/common/StatusBadge';
import { Avatar } from '../../components/common/Avatar';
import { VehicleCard } from '../../components/cards/VehicleCard';
import { DriverCard } from '../../components/cards/DriverCard';
import { BookingCard } from '../../components/cards/BookingCard';
import { MapPanel } from '../../components/map/MapPanel';
import { BottomSheet } from '../../components/common/BottomSheet';
import { Modal } from '../../components/common/Modal';
import { ConfirmationDialog } from '../../components/common/ConfirmationDialog';
import { CustomerBottomNav, CustomerNavTab } from '../../components/navigation/CustomerBottomNav';
import { useToast } from '../../components/common/Toast';
import {
  ApiBooking,
  cancelBooking,
  createBooking,
  createVehicle,
  formatAed,
  getBooking,
  getTariffs,
  isFinalStatus,
  listBookings,
  listVehicles,
  Quote,
  removeVehicle,
  requestQuote,
  Tariff,
  toUiBooking,
  toUiDriver,
  latLngToMap,
  rateBooking,
  getNearby,
  NearbyAvailability,
  raiseDispute,
  getMyDisputes,
  Dispute,
  PlaceSearch,
  searchPlaces,
  toUiPlace,
  withLiveLocation,
  getDriverLocation,
  etaLabel,
  DriverLocationView,
  toUiVehicle,
  towTypeFits,
  updateVehicle,
} from '../../services/bookings';
import { useRealtime } from '../../services/realtime';
import { loadStripe } from '@stripe/stripe-js';
import type { Stripe, StripeElements } from '@stripe/stripe-js';
import {
  getInvoice,
  getPaymentSession,
  Invoice,
  invoiceText,
  PAYMENT_STATUS_LABELS,
  syncPayment,
  getPaymentMethods,
} from '../../services/payments';
import { getInbox, Inbox, markAllRead, timeAgo } from '../../services/notifications';
import { BOOKING_STATUS_LABELS, TOW_SERVICES, TOW_TYPE_LABELS, VEHICLE_ISSUES, disputeReasonError, ratingComment as buildRatingComment, visiblePaymentMethods } from '../../services/catalog';
import { Skeleton } from '../../components/common/LoadingSkeleton';
import { ApiError } from '../../services/api';
import { useAuth } from '../../services/useAuth';
import { updateCustomerProfile } from '../../services/profile';
import { displayPhone, formatLocal } from '../../services/phone';
import { useOtpSignIn } from '../../services/useOtpSignIn';
import { OtpInput } from '../../components/common/OtpInput';

export interface CustomerAppProps {
  initialScreen?: string;
  onScreenChange?: (screen: string) => void;
}

/** Optional support line (like the mobile SUPPORT_PHONE build setting); hidden when not set. */
const SUPPORT_PHONE = (import.meta.env.VITE_SUPPORT_PHONE as string | undefined)?.trim() || '';

// Same services and wording as the mobile customer app (src/services/catalog.ts).
const TOW_OPTIONS: { type: TowType; title: string; desc: string }[] = TOW_SERVICES.map((s) => ({ ...s }));

const EMIRATES: Emirate[] = [
  'Dubai',
  'Abu Dhabi',
  'Sharjah',
  'Ajman',
  'Umm Al Quwain',
  'Ras Al Khaimah',
  'Fujairah',
];

export const CustomerApp: React.FC<CustomerAppProps> = ({
  initialScreen = 'home',
  onScreenChange,
}) => {
  const { showToast } = useToast();

  // Screen controller
  const [currentScreen, setCurrentScreen] = useState<string>(initialScreen);

  // Booking Flow State
  // Registered vehicles come from the API (see the vehicles block below).
  const [vehicles, setVehicles] = useState<CustomerVehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const selectedVehicle =
    vehicles.find((v) => v.id === selectedVehicleId) ??
    vehicles.find((v) => v.isDefault) ??
    vehicles[0] ??
    null;
  // Nothing is preselected: without lat/lng no quote is requested until the user picks a place.
  const notSet = (what: string): LocationItem => ({
    id: `unset-${what}`,
    name: `Choose ${what}`,
    address: 'Not set yet',
    city: 'Dubai',
    coordinates: { x: 50, y: 50 },
  });
  const [pickupLocation, setPickupLocation] = useState<LocationItem>(() => notSet('pickup'));
  const [dropoffLocation, setDropoffLocation] = useState<LocationItem>(() => notSet('drop-off'));
  // Pickup starts at the device's real position when the browser shares it.
  React.useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      ({ coords }) => {
        const p = { lat: +coords.latitude.toFixed(6), lng: +coords.longitude.toFixed(6) };
        setPickupLocation({
          id: 'gps',
          name: 'Current location',
          address: `GPS ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`,
          city: 'Dubai',
          coordinates: latLngToMap(p),
          ...p,
          type: 'current',
        });
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, []);
  // Which field the map screen is editing
  const [locationTarget, setLocationTarget] = useState<'pickup' | 'dropoff'>('pickup');
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState<PlaceSearch['results']>([]);
  const [selectedIssue, setSelectedIssue] = useState<VehicleIssue>(VEHICLE_ISSUES[0]);
  const [selectedTowType, setSelectedTowType] = useState<TowType>('flatbed');
  const [requestNotes, setRequestNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash'); // cash is the agreed business model

  // Rating State
  const [ratingStars, setRatingStars] = useState(5);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [ratingComment, setRatingComment] = useState('');

  // Modals & Bottom Sheets
  const [isAddVehicleOpen, setIsAddVehicleOpen] = useState(false);
  const [isSosSheetOpen, setIsSosSheetOpen] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  // Disputes (POST /bookings/:id/disputes, GET /me/disputes) — same rules as the mobile app.
  const [disputeTarget, setDisputeTarget] = useState<ApiBooking | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeBusy, setDisputeBusy] = useState(false);
  const [myDisputes, setMyDisputes] = useState<Dispute[] | null>(null);
  const openDispute = (b: ApiBooking) => {
    setDisputeReason('');
    setDisputeTarget(b);
  };

  // New Vehicle Form State
  const [newVehicle, setNewVehicle] = useState({
    brand: '',
    model: '',
    year: '2024',
    color: 'White',
    plateNumber: '',
    plateCode: 'A',
    plateEmirate: 'Dubai' as Emirate,
    category: 'car' as 'car' | 'motorbike',
  });
  const [newVehicleErrors, setNewVehicleErrors] = useState<Record<string, string>>({});

  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [savingVehicle, setSavingVehicle] = useState(false);
  const [vehicleToRemove, setVehicleToRemove] = useState<CustomerVehicle | null>(null);

  const openAddVehicle = () => {
    setEditingVehicleId(null);
    setNewVehicle({
      brand: '',
      model: '',
      year: String(new Date().getFullYear()),
      color: '',
      plateNumber: '',
      plateCode: '',
      plateEmirate: 'Dubai',
      category: 'car',
    });
    setNewVehicleErrors({});
    setIsAddVehicleOpen(true);
  };

  const openEditVehicle = (v: CustomerVehicle) => {
    setEditingVehicleId(v.id);
    setNewVehicle({
      brand: v.brand,
      model: v.model,
      year: String(v.year),
      color: v.color,
      plateNumber: v.plateNumber,
      plateCode: v.plateCode,
      plateEmirate: v.plateEmirate,
      category: v.category,
    });
    setNewVehicleErrors({});
    setIsAddVehicleOpen(true);
  };

  const handleAddVehicle = async () => {
    // Instant feedback only; the API validates again and is the authority.
    const errors: Record<string, string> = {};
    if (!newVehicle.brand.trim()) errors.brand = 'Brand is required';
    if (!newVehicle.model.trim()) errors.model = 'Model is required';
    if (!/^\d{1,5}$/.test(newVehicle.plateNumber.trim()))
      errors.plateNumber = 'Enter a 1–5 digit plate number';
    if (!/^[A-Za-z0-9]{1,3}$/.test(newVehicle.plateCode.trim()))
      errors.plateCode = 'Enter a 1–3 character code';
    const year = Number(newVehicle.year);
    if (!Number.isInteger(year) || year < 1950 || year > new Date().getFullYear() + 1)
      errors.year = 'Enter a valid year';
    setNewVehicleErrors(errors);
    if (Object.keys(errors).length) return;

    const input = {
      category: newVehicle.category,
      brand: newVehicle.brand.trim(),
      model: newVehicle.model.trim(),
      year,
      ...(newVehicle.color.trim() && { color: newVehicle.color.trim() }),
      plateEmirate: newVehicle.plateEmirate,
      plateCode: newVehicle.plateCode.trim().toUpperCase(),
      plateNumber: newVehicle.plateNumber.trim(),
    };
    setSavingVehicle(true);
    try {
      const saved = editingVehicleId
        ? await updateVehicle(auth.client, editingVehicleId, input)
        : await createVehicle(auth.client, input);
      await reloadVehicles();
      setSelectedVehicleId(saved.id);
      setIsAddVehicleOpen(false);
      showToast(`${saved.brand} ${saved.model} ${editingVehicleId ? 'updated' : 'added'}`, 'success');
    } catch (err) {
      setNewVehicleErrors({
        form: err instanceof ApiError ? err.message : 'Could not save the vehicle. Please try again.',
      });
    } finally {
      setSavingVehicle(false);
    }
  };

  const confirmRemoveVehicle = async () => {
    const target = vehicleToRemove;
    if (!target) return;
    setVehicleToRemove(null);
    try {
      await removeVehicle(auth.client, target.id);
      if (selectedVehicleId === target.id) setSelectedVehicleId(null);
      await reloadVehicles();
      showToast(`${target.brand} ${target.model} removed`, 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not remove the vehicle.', 'error');
    }
  };

  // Login & OTP (real API: SMS one-time passcode, see backend/src/modules/auth)
  const auth = useAuth('customer');
  // Only the methods the server accepts (card / Apple Pay need PAYMENT_PROVIDER=stripe).
  const [acceptedMethods, setAcceptedMethods] = useState<PaymentMethod[] | null>(null);
  React.useEffect(() => {
    getPaymentMethods(auth.client)
      .then((r) => setAcceptedMethods(r.methods))
      .catch(() => setAcceptedMethods(['cash']));
  }, []);
  const paymentOptions = visiblePaymentMethods(acceptedMethods);
  // Trucks near the pickup per service (GET /availability/nearby) — same data as the mobile home.
  const [nearby, setNearby] = useState<NearbyAvailability | null>(null);
  React.useEffect(() => {
    if (currentScreen !== 'home' || !auth.user || pickupLocation.lat == null || pickupLocation.lng == null) return;
    let active = true;
    getNearby(auth.client, { lat: pickupLocation.lat, lng: pickupLocation.lng })
      .then((n) => active && setNearby(n))
      .catch(() => active && setNearby(null));
    return () => {
      active = false;
    };
  }, [currentScreen, auth.user?.id, pickupLocation.lat, pickupLocation.lng]);
  React.useEffect(() => {
    if (!paymentOptions.includes(paymentMethod)) setPaymentMethod('cash');
  }, [acceptedMethods]);
  const signIn = useOtpSignIn(auth, {
    onCodeSent: () => navigateTo('otp'),
    onSignedIn: (session) => {
      navigateTo('home');
      showToast(session.isNewUser ? 'Welcome to TowNow!' : 'Signed in', 'success');
    },
    onNeedPhone: () => navigateTo('login'),
    notify: (message, type) => showToast(message, type),
  });

  // Profile (real API)
  const signedInName = auth.user ? auth.user.fullName ?? 'TowNow Customer' : null;
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editError, setEditError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const openEditProfile = () => {
    setEditName(auth.user?.fullName ?? '');
    setEditEmail(auth.user?.email ?? '');
    setEditError('');
    setIsEditProfileOpen(true);
  };

  const saveProfile = async () => {
    setSavingProfile(true);
    setEditError('');
    try {
      const profile = await updateCustomerProfile(auth.client, {
        ...(editName.trim() && { fullName: editName }),
        email: editEmail.trim() ? editEmail : null,
      });
      auth.setUser(profile.user);
      setIsEditProfileOpen(false);
      showToast('Profile updated', 'success');
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Could not save. Please try again.');
    } finally {
      setSavingProfile(false);
    }
  };

  const signOut = async () => {
    await auth.logout().catch(() => undefined);
    showToast('Signed out', 'info');
    navigateTo('welcome');
  };

  // Vehicles (real API)
  const reloadVehicles = React.useCallback(async () => {
    const list = await listVehicles(auth.client);
    setVehicles(list.map(toUiVehicle));
  }, [auth.client]);

  React.useEffect(() => {
    if (!auth.user) {
      setVehicles([]);
      setSelectedVehicleId(null);
      return;
    }
    reloadVehicles().catch(() => showToast('Could not load your vehicles.', 'error'));
  }, [auth.user, reloadVehicles]);

  // Tariffs ("from AED …" labels) — priced by the API, never hardcoded here.
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  React.useEffect(() => {
    getTariffs(auth.client)
      .then(setTariffs)
      .catch(() => setTariffs([]));
  }, [auth.client]);
  const tariffFor = (t: TowType) => tariffs.find((x) => x.towType === t);

  // Server fare quote for the current selections
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [bookingBusy, setBookingBusy] = useState(false);

  const fetchQuote = React.useCallback(async () => {
    setQuote(null);
    setQuoteError('');
    if (!auth.user) {
      setQuoteError('Sign in to get a price for your tow.');
      return;
    }
    if (!selectedVehicle) {
      setQuoteError('Add the vehicle that needs towing first.');
      return;
    }
    if (pickupLocation.lat === undefined || dropoffLocation.lat === undefined) {
      setQuoteError('Choose the pickup and drop-off on the map.');
      return;
    }
    setQuoteLoading(true);
    try {
      setQuote(
        await requestQuote(auth.client, {
          vehicleId: selectedVehicle.id,
          towType: selectedTowType,
          pickup: { lat: pickupLocation.lat, lng: pickupLocation.lng!, address: pickupLocation.address },
          dropoff: { lat: dropoffLocation.lat, lng: dropoffLocation.lng!, address: dropoffLocation.address },
        }),
      );
    } catch (err) {
      setQuoteError(err instanceof ApiError ? err.message : 'Could not get a price. Please try again.');
    } finally {
      setQuoteLoading(false);
    }
  }, [auth.user, auth.client, selectedVehicle?.id, selectedTowType, pickupLocation, dropoffLocation]);

  React.useEffect(() => {
    if (currentScreen === 'fare_estimate') void fetchQuote();
  }, [currentScreen, fetchQuote]);

  // Bookings (real API)
  const [bookings, setBookings] = useState<ApiBooking[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [detailBooking, setDetailBooking] = useState<ApiBooking | null>(null);
  const [lastCreatedBooking, setLastCreatedBooking] = useState<ApiBooking | null>(null);
  const activeRequest = bookings.find((b) => !isFinalStatus(b.status)) ?? null;

  const reloadBookings = React.useCallback(async () => {
    setBookingsLoading(true);
    try {
      setBookings((await listBookings(auth.client)).items);
    } finally {
      setBookingsLoading(false);
    }
  }, [auth.client]);

  React.useEffect(() => {
    if (!auth.user) {
      setBookings([]);
      return;
    }
    reloadBookings().catch(() => undefined);
  }, [auth.user, reloadBookings]);

  // Live trip: the booking with a driver that the customer is following.
  const trackedTrip =
    [detailBooking, lastCreatedBooking, activeRequest].find((b) => b?.driver && !isFinalStatus(b.status)) ?? null;
  const [completedTrip, setCompletedTrip] = useState<ApiBooking | null>(null);
  const [live, setLive] = useState<DriverLocationView | null>(null);
  const seenStatus = React.useRef<Record<string, string>>({});
  const TRIP_SCREENS = ['driver_found', 'live_tracking', 'trip_status'];
  const STATUS_TOAST: Record<string, string> = {
    driver_arriving: 'Your driver is on the way',
    driver_arrived: 'Your driver has arrived',
    in_transit: 'Your vehicle is loaded — tow started',
    completed: 'Tow completed. Your vehicle has been delivered.',
  };

  /** Refresh a booking the customer is following and move the trip screens along with it. */
  const syncWatchedBooking = async (bookingId: string) => {
    const watched =
      detailBooking?.id === bookingId || lastCreatedBooking?.id === bookingId || activeRequest?.id === bookingId;
    if (!watched) return;
    const fresh = await getBooking(auth.client, bookingId);
    setDetailBooking((cur) => (cur?.id === fresh.id ? fresh : cur));
    setLastCreatedBooking((cur) => (cur?.id === fresh.id ? fresh : cur));
    const previous = seenStatus.current[bookingId];
    seenStatus.current[bookingId] = fresh.status;
    if (previous === fresh.status) return;
    if (fresh.driver && currentScreen === 'searching') {
      navigateTo('driver_found');
      showToast(`${fresh.driver.firstName} accepted your tow request`, 'success');
      return;
    }
    const onTripScreen = TRIP_SCREENS.includes(currentScreen);
    if (STATUS_TOAST[fresh.status] && (onTripScreen || currentScreen === 'order_details')) {
      showToast(STATUS_TOAST[fresh.status], fresh.status === 'completed' ? 'success' : 'info');
    }
    if (fresh.status === 'completed' && onTripScreen) {
      setCompletedTrip(fresh);
      setLive(null);
      navigateTo('completion');
    }
  };

  useRealtime(auth.client, auth.user?.id ?? null, {
    'booking:updated': (e: { bookingId: string; status: string }) => {
      reloadBookings().catch(() => undefined);
      syncWatchedBooking(e.bookingId).catch(() => undefined);
    },
    'payment:updated': (e: { bookingId: string; status: string }) => {
      reloadBookings().catch(() => undefined);
      getBooking(auth.client, e.bookingId)
        .then((fresh) => {
          setLastCreatedBooking((cur) => (cur?.id === fresh.id ? fresh : cur));
          setDetailBooking((cur) => (cur?.id === fresh.id ? fresh : cur));
        })
        .catch(() => undefined);
      if (currentScreen === 'card_payment' && lastCreatedBooking?.id === e.bookingId && e.status === 'authorized') {
        showToast('Card authorised — finding your driver', 'success');
        navigateTo('searching');
      }
    },
    // Live driver position (only ever sent for this customer's own booking).
    'trip:location': (e: { bookingId: string; lat: number; lng: number; recordedAt: string; headingDegrees?: number }) => {
      setLive((cur) =>
        cur && cur.bookingId === e.bookingId
          ? {
              ...cur,
              location: {
                lat: e.lat,
                lng: e.lng,
                recordedAt: e.recordedAt,
                ageSeconds: Math.max(0, Math.round((Date.now() - Date.parse(e.recordedAt)) / 1000)),
                stale: false,
                ...(e.headingDegrees !== undefined && { headingDegrees: e.headingDegrees }),
              },
            }
          : cur,
      );
    },
  });

  // REST: position + ETA every 15 s on the trip screens (the socket fills in between), plus status fallback.
  React.useEffect(() => {
    if (!trackedTrip || !TRIP_SCREENS.includes(currentScreen)) return;
    let active = true;
    const load = () => {
      getDriverLocation(auth.client, trackedTrip.id)
        .then((view) => active && setLive(view))
        .catch(() => undefined);
      syncWatchedBooking(trackedTrip.id).catch(() => undefined);
    };
    load();
    const timer = setInterval(load, 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [trackedTrip?.id, trackedTrip?.status, currentScreen]);

  React.useEffect(() => {
    if (currentScreen !== 'disputes' || !auth.user) return;
    let active = true;
    setMyDisputes(null);
    getMyDisputes(auth.client)
      .then((d) => active && setMyDisputes(d))
      .catch(() => {
        if (!active) return;
        setMyDisputes([]);
        showToast('Could not load your disputes. Check your connection.', 'error');
      });
    return () => {
      active = false;
    };
  }, [currentScreen, auth.user?.id]);

  // In-app inbox (GET /me/notifications), refreshed each time the screen opens.
  const [inbox, setInbox] = useState<Inbox | null>(null);
  React.useEffect(() => {
    if (!['home', 'notifications'].includes(currentScreen) || !auth.user) return;
    let active = true;
    getInbox(auth.client)
      .then((x) => active && setInbox(x))
      .catch(() => {
        if (!active) return;
        setInbox({ items: [], unread: 0, total: 0 });
        showToast('Could not load notifications. Check your connection.', 'error');
      });
    return () => {
      active = false;
    };
  }, [currentScreen, auth.user?.id]);

  // Real invoice for the completed booking on screen (completion or order details).
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  React.useEffect(() => {
    const target =
      currentScreen === 'completion'
        ? completedTrip
        : currentScreen === 'order_details'
          ? detailBooking
          : null;
    if (!target || target.status !== 'completed') {
      setInvoice(null);
      return;
    }
    let active = true;
    getInvoice(auth.client, target.id)
      .then((inv) => active && setInvoice(inv))
      .catch(() => active && setInvoice(null));
    return () => {
      active = false;
    };
  }, [currentScreen, completedTrip?.id, detailBooking?.id, detailBooking?.status]);

  // Card payment step: Stripe's Payment Element (card details never reach TowNow).
  const cardMountRef = React.useRef<HTMLDivElement>(null);
  const stripeRef = React.useRef<{ stripe: Stripe; elements: StripeElements } | null>(null);
  const [cardState, setCardState] = useState<'loading' | 'ready' | 'paying' | 'error'>('loading');
  const [cardError, setCardError] = useState('');

  React.useEffect(() => {
    if (currentScreen !== 'card_payment' || !lastCreatedBooking) return;
    let cancelled = false;
    let destroy: (() => void) | null = null;
    setCardState('loading');
    setCardError('');
    (async () => {
      try {
        const session = await getPaymentSession(auth.client, lastCreatedBooking.id);
        if (session.status === 'authorized' || session.status === 'captured') {
          navigateTo('searching');
          return;
        }
        if (!session.clientSecret) throw new Error('This payment can no longer be completed.');
        const stripe = await loadStripe(session.publishableKey);
        if (!stripe) throw new Error('Could not load the secure payment form.');
        if (cancelled || !cardMountRef.current) return;
        const elements = stripe.elements({
          clientSecret: session.clientSecret,
          appearance: { theme: 'stripe', variables: { colorPrimary: '#101827', borderRadius: '14px' } },
        });
        const element = elements.create('payment');
        element.mount(cardMountRef.current);
        destroy = () => element.destroy();
        stripeRef.current = { stripe, elements };
        setCardState('ready');
      } catch (err) {
        if (cancelled) return;
        setCardError(err instanceof Error ? err.message : 'Could not start the payment.');
        setCardState('error');
      }
    })();
    return () => {
      cancelled = true;
      destroy?.();
      stripeRef.current = null;
    };
  }, [currentScreen, lastCreatedBooking?.id]);

  const payNow = async () => {
    const s = stripeRef.current;
    if (!s || !lastCreatedBooking) return;
    setCardState('paying');
    setCardError('');
    const { error } = await s.stripe.confirmPayment({
      elements: s.elements,
      redirect: 'if_required',
      confirmParams: { return_url: window.location.href },
    });
    if (error) {
      setCardError(error.message ?? 'The payment was not completed.');
      setCardState('ready');
      return;
    }
    try {
      // The server asks Stripe for the result — the browser's word is never taken for it.
      const payment = await syncPayment(auth.client, lastCreatedBooking.id);
      if (payment.status === 'authorized' || payment.status === 'captured') {
        showToast('Card authorised — finding your driver', 'success');
        navigateTo('searching');
        return;
      }
      setCardError(payment.failureReason ?? 'The payment is still processing. Please wait a moment.');
    } catch (err) {
      setCardError(err instanceof ApiError ? err.message : 'Could not confirm the payment.');
    }
    setCardState('ready');
  };

  const TRIP_STATUS_LABEL = BOOKING_STATUS_LABELS; // shared with mobile
  const liveFreshness = !live?.location
    ? 'Waiting for the driver\'s GPS…'
    : live.location.stale
      ? `Last seen ${Math.round(live.location.ageSeconds / 60)} min ago — signal lost`
      : `Updated ${live.location.ageSeconds}s ago`;

  // REST fallback while waiting for a driver (e.g. socket blocked by a network).
  React.useEffect(() => {
    if (currentScreen !== 'searching' || !lastCreatedBooking || lastCreatedBooking.driver) return;
    const timer = setInterval(() => {
      syncWatchedBooking(lastCreatedBooking.id).catch(() => undefined);
    }, 5_000);
    return () => clearInterval(timer);
  }, [currentScreen, lastCreatedBooking?.id, lastCreatedBooking?.driver]);

  const openBookingDetails = async (id: string) => {
    try {
      setDetailBooking(await getBooking(auth.client, id));
      navigateTo('order_details');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not open the booking.', 'error');
    }
  };

  const confirmBooking = async () => {
    if (!quote) return;
    setBookingBusy(true);
    try {
      const booking = await createBooking(auth.client, {
        quoteId: quote.quoteId,
        issue: selectedIssue,
        ...(requestNotes.trim() && { notes: requestNotes.trim() }),
        paymentMethod,
      });
      setLastCreatedBooking(booking);
      setDetailBooking(booking);
      setRequestNotes('');
      await reloadBookings().catch(() => undefined);
      if (booking.paymentMethod === 'cash') {
        navigateTo('searching');
        showToast(`Tow request ${booking.bookingNumber} received`, 'success');
      } else {
        // Card / Apple Pay: authorise first; dispatch starts once the funds are held.
        navigateTo('card_payment');
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not book. Please try again.';
      showToast(message, 'error');
      if (err instanceof ApiError && err.status === 410) navigateTo('fare_estimate'); // fresh quote
    } finally {
      setBookingBusy(false);
    }
  };

  // Driver of the trip on screen (live, else the one just completed) for chat / profile / rating.
  const shownTrip = trackedTrip ?? (completedTrip?.driver ? completedTrip : null);
  const tripDriver = shownTrip?.driver ? toUiDriver(shownTrip.driver, shownTrip.pickup) : null;

  const paymentLabels: Record<PaymentMethod, string> = {
    card: 'Card',
    apple_pay: 'Apple Pay',
    cash: 'Cash to Driver',
  };

  // Orders
  const [ordersTab, setOrdersTab] = useState<'active' | 'completed' | 'cancelled'>('active');

  // Chat, driver profile & cancellation
  const [returnScreen, setReturnScreen] = useState('live_tracking');
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const cancelReasons = [
    'Driver is taking too long',
    'Vehicle started working',
    'Booked by mistake',
    'Found another provider',
    'Other',
  ];

  const openFromCurrent = (screen: string) => {
    setReturnScreen(currentScreen);
    navigateTo(screen);
  };


  /** The booking the cancel dialog acts on: the one on screen, else the open request. */
  const cancelTarget =
    (currentScreen === 'order_details' ? detailBooking : null) ??
    (currentScreen === 'searching' || currentScreen === 'card_payment' ? lastCreatedBooking : null) ??
    activeRequest;

  const confirmCancel = async () => {
    if (!cancelReason) {
      showToast('Please select a reason for cancelling', 'error');
      return;
    }
    if (!cancelTarget) {
      setIsCancelOpen(false);
      showToast('There is no active tow request to cancel.', 'info');
      return;
    }
    try {
      const cancelled = await cancelBooking(auth.client, cancelTarget.id, cancelReason);
      setIsCancelOpen(false);
      setCancelReason('');
      setDetailBooking(cancelled);
      await reloadBookings().catch(() => undefined);
      navigateTo('order_details');
      showToast(`Tow request ${cancelled.bookingNumber} cancelled`, 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not cancel. Please try again.', 'error');
    }
  };

  const openLocationPicker = (target: 'pickup' | 'dropoff') => {
    setLocationTarget(target);
    navigateTo('location_select');
  };

  // Keep screen state synchronized when parent changes it
  React.useEffect(() => {
    if (initialScreen && initialScreen !== currentScreen) {
      setCurrentScreen(initialScreen);
    }
  }, [initialScreen]);

  const navigateTo = (screen: string) => {
    setCurrentScreen(screen);
    onScreenChange?.(screen);
  };
  // The bottom nav only shows on its four tab screens, so the active tab is the current screen
  const bottomNavTab = currentScreen as CustomerNavTab;

  const handleBottomNavChange = (tab: CustomerNavTab) => {
    navigateTo(tab);
  };

  const issuesList: VehicleIssue[] = [...VEHICLE_ISSUES];

  const renderScreen = () => {
  /* -------------------------------------------------------------
   * 1. SPLASH SCREEN
   * ------------------------------------------------------------- */
  if (currentScreen === 'splash') {
    return (
      <div className="flex-1 flex flex-col justify-between items-center p-8 bg-gradient-to-b from-canvas via-canvas to-canvas text-center select-none">
        <div className="pt-20">
          <div className="w-20 h-20 rounded-3xl bg-lime text-navy font-black text-3xl flex items-center justify-center mx-auto shadow-2xl shadow-navy/10 ring-4 ring-navy/20">
            TN
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink mt-6">TowNow</h1>
          <p className="text-xs text-navy font-semibold uppercase tracking-widest mt-1">
            UAE On-Demand Recovery
          </p>
        </div>

        <div className="w-full max-w-xs relative my-6">
          <div className="rounded-2xl overflow-hidden border border-line shadow-2xl">
            <img
              src={ASSETS.flatbedHero}
              alt="TowNow Flatbed"
              referrerPolicy="no-referrer"
              className="w-full h-44 object-cover"
            />
          </div>
          <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-surface border border-line text-[10px] text-ink/80 shadow-md">
            Verified tow trucks across the UAE
          </div>
        </div>

        <div className="w-full space-y-3 pb-8">
          <Button variant="primary" fullWidth size="lg" onClick={() => navigateTo('welcome')}>
            Get Started
          </Button>
          <p className="text-[11px] text-muted">Official UAE Mobility Standard</p>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 2. WELCOME / ONBOARDING SCREEN
   * ------------------------------------------------------------- */
  if (currentScreen === 'welcome') {
    return (
      <div className="flex-1 flex flex-col justify-between p-6 bg-canvas text-ink">
        <div className="flex items-center justify-between pt-2">
          <div className="text-sm font-bold text-navy tracking-tight">TowNow</div>
          <button
            onClick={() => navigateTo('home')}
            className="text-xs text-muted hover:text-ink"
          >
            Skip to Home
          </button>
        </div>

        <div className="my-auto py-6 text-center space-y-5">
          <div className="rounded-3xl overflow-hidden border border-line shadow-2xl mx-auto max-w-sm">
            <img
              src={ASSETS.wheelLiftTruck}
              alt="Roadside Assistance"
              referrerPolicy="no-referrer"
              className="w-full h-48 object-cover"
            />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-ink">
              Roadside towing, across the UAE
            </h2>
            <p className="text-xs text-muted max-w-xs mx-auto leading-relaxed">
              Verified tow trucks. Upfront prices. Pay the driver in cash.
            </p>
          </div>

          <div className="flex justify-center gap-1.5 pt-2">
            <span className="w-6 h-1.5 rounded-full bg-lime" />
            <span className="w-1.5 h-1.5 rounded-full bg-line" />
            <span className="w-1.5 h-1.5 rounded-full bg-line" />
          </div>
        </div>

        <div className="space-y-3 pb-4">
          <Button variant="primary" fullWidth size="lg" onClick={() => navigateTo('login')}>
            Continue with Phone Number
          </Button>
          <Button variant="outline" fullWidth size="md" onClick={() => navigateTo('home')}>
            Explore Platform as Guest
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 3. LOGIN SCREEN (+971 UAE)
   * ------------------------------------------------------------- */
  if (currentScreen === 'login') {
    return (
      <div className="flex-1 flex flex-col justify-between p-6 bg-canvas text-ink">
        <div>
          <button
            onClick={() => navigateTo('welcome')}
            className="p-2 -ml-2 text-muted hover:text-ink rounded-lg flex items-center gap-1 text-xs"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Back</span>
          </button>

          <div className="mt-8 space-y-2">
            <h2 className="text-2xl font-bold text-ink">Enter UAE Mobile Number</h2>
            <p className="text-xs text-muted">
              We'll send an authentication passcode to verify your account.
            </p>
          </div>

          <div className="mt-8 space-y-4">
            <div>
              <label className="block text-xs font-medium text-ink/80 mb-2">
                Mobile Number
              </label>
              <div className="flex items-center gap-2">
                {/* UAE Flag & Country Code */}
                <div className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-surface border border-line text-xs font-semibold text-ink shrink-0">
                  <span className="text-base leading-none">🇦🇪</span>
                  <span>+971</span>
                </div>
                <input
                  type="tel"
                  inputMode="tel"
                  aria-label="Mobile Number"
                  value={signIn.phone}
                  maxLength={13}
                  onChange={(e) => signIn.setPhone(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void signIn.submitPhone()}
                  placeholder="50 XXX XXXX"
                  className={`flex-1 bg-surface text-ink font-mono text-sm rounded-xl border px-3.5 py-2.5 outline-none ${
                    signIn.phoneError ? 'border-danger' : 'border-line focus:border-navy'
                  }`}
                />
              </div>
              {signIn.phoneError && (
                <p className="mt-1.5 text-xs text-danger font-medium">{signIn.phoneError}</p>
              )}
            </div>

            <p className="text-[11px] text-muted leading-relaxed">
              By proceeding, you agree to TowNow Terms of Service and Privacy Policy for Dubai and
              Abu Dhabi emirates.
            </p>
          </div>
        </div>

        <div className="pb-4">
          <Button variant="primary" fullWidth size="lg" onClick={signIn.submitPhone} isLoading={signIn.busy}>
            Send Verification Code
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 4. OTP SCREEN (6-DIGIT)
   * ------------------------------------------------------------- */
  if (currentScreen === 'otp') {
    return (
      <div className="flex-1 flex flex-col justify-between p-6 bg-canvas text-ink">
        <div>
          <button
            onClick={() => navigateTo('login')}
            className="p-2 -ml-2 text-muted hover:text-ink rounded-lg flex items-center gap-1 text-xs"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Change Number</span>
          </button>

          <div className="mt-8 space-y-2">
            <h2 className="text-2xl font-bold text-ink">Verification Code</h2>
            <p className="text-xs text-muted">
              Enter the 6-digit code sent to{' '}
              <span className="font-semibold text-ink">{displayPhone(signIn.phone)}</span>
            </p>
          </div>

          {/* 6 Digit Input Boxes */}
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
            Verify & Enter App
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 5. HOME SCREEN (Uber/Careem style with Map Hero)
   * ------------------------------------------------------------- */
  if (currentScreen === 'home') {
    return (
      <div className="flex-1 flex flex-col bg-canvas text-ink">
        {/* Top Header */}
        <div className="p-5 pb-3 flex items-center justify-between border-b border-line bg-surface/40 backdrop-blur-md sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <Avatar name={signedInName ?? 'Guest'} size="md" />
            <div>
              <div className="text-[11px] text-muted">Marhaba</div>
              <div className="text-sm font-bold text-ink">{signedInName ?? 'Guest'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsSosSheetOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-danger/10 border border-danger/30 text-danger text-xs font-bold hover:bg-danger/10 transition-colors shadow-sm"
            >
              <AlertOctagon className="w-3.5 h-3.5 text-danger" />
              <span>SOS</span>
            </button>
          </div>
        </div>

        {/* Scrollable Feed */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-20">
          {/* Current Location Pill & Map Hero Visual */}
          <div className="rounded-2xl overflow-hidden border border-line relative shadow-xl">
            <MapPanel height="h-64 sm:h-80" pickup={pickupLocation} interactive={false} />
            <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface/95 border border-line backdrop-blur-md shadow-lg text-xs">
                <MapPin className="w-3.5 h-3.5 text-navy" />
                <span className="font-semibold text-ink truncate max-w-[150px]">
                  {pickupLocation.name}
                </span>
              </div>
            </div>
            {/* Urgent Dispatch Banner Overlay */}
            <div className="absolute bottom-7 left-3 right-3">
              <Button
                variant="primary"
                size="lg"
                fullWidth
                onClick={() => navigateTo('request_tow')}
                leftIcon={<Zap className="w-4 h-4" />}
                className="shadow-xl shadow-navy/10"
              >
                Need a Tow? Request Dispatch Now
              </Button>
            </div>
          </div>

          {/* Active tow request banner (real booking) */}
          {activeRequest && (
          <div
            onClick={() => void openBookingDetails(activeRequest.id)}
            className="p-3.5 rounded-2xl bg-lime/20 border border-navy/30 flex items-center justify-between cursor-pointer hover:bg-lime/30 transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-lime text-navy flex items-center justify-center font-bold">
                <Truck className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-navy">
                    Tow Request {activeRequest.bookingNumber}
                  </span>
                  <span className="w-2 h-2 rounded-full bg-lime animate-ping" />
                </div>
                <p className="text-[11px] text-muted">
                  {activeRequest.vehicle.brand} {activeRequest.vehicle.model} ·{' '}
                  {formatAed(activeRequest.fare.totalFils)} · tap for details
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-navy" />
          </div>
          )}

          {/* Roadside Services Grid */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted">
                TowNow Services
              </h3>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {TOW_OPTIONS.map((o) => {
                const n = nearby?.byTowType.find((x) => x.towType === o.type);
                return { label: o.title, icon: o.type === 'flatbed' ? Truck : o.type === 'wheel-lift' ? Sliders : Bike, type: o.type,
                  eta: !n ? '' : n.available > 0 ? `${n.available} nearby` : 'None nearby' };
              }).map((svc, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setSelectedTowType(svc.type);
                    navigateTo('request_tow');
                  }}
                  className="flex flex-col items-center justify-center p-3 rounded-2xl bg-surface border border-line hover:border-navy/50 hover:bg-canvas transition-all text-center group"
                >
                  <div className="w-10 h-10 rounded-xl bg-canvas border border-line flex items-center justify-center text-navy group-hover:scale-105 transition-transform mb-1.5">
                    <svc.icon className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-semibold text-ink truncate w-full">
                    {svc.label}
                  </span>
                  <span className={`text-[10px] tabular-nums ${svc.eta.startsWith('None') ? 'text-muted' : 'text-success'}`}>{svc.eta}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Selected Vehicle Card */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted">
                Active Vehicle
              </h3>
              <button
                onClick={() => navigateTo('vehicle_select')}
                className="text-xs text-navy font-semibold hover:underline"
              >
                Change Vehicle
              </button>
            </div>
            {selectedVehicle ? (
              <VehicleCard vehicle={selectedVehicle} selected={true} />
            ) : (
              <button
                onClick={() => (auth.user ? openAddVehicle() : navigateTo('login'))}
                className="w-full py-4 rounded-2xl border border-dashed border-line bg-surface/40 text-ink/80 hover:text-navy hover:border-navy/50 flex items-center justify-center gap-2 text-xs font-semibold transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>{auth.user ? 'Add your vehicle' : 'Sign in to add your vehicle'}</span>
              </button>
            )}
          </div>

          {/* Saved Destinations */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted">
                Popular Places
              </h3>
              <button
                onClick={() => openLocationPicker('pickup')}
                className="text-xs text-navy font-medium"
              >
                Select on Map
              </button>
            </div>
            <div className="space-y-2">
              {MOCK_LOCATIONS.slice(1, 3).map((loc) => (
                <div
                  key={loc.id}
                  onClick={() => {
                    setDropoffLocation(loc);
                    navigateTo('fare_estimate');
                  }}
                  className="p-3 rounded-xl bg-surface border border-line flex items-center justify-between cursor-pointer hover:border-line hover:bg-canvas transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-canvas flex items-center justify-center text-muted shrink-0">
                      <MapPin className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-ink truncate">
                        {loc.name}
                      </div>
                      <div className="text-[11px] text-muted truncate">{loc.address}</div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted shrink-0" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Nav */}
        <CustomerBottomNav activeTab={bottomNavTab} onChangeTab={handleBottomNavChange} unreadNotifications={inbox?.unread ?? 0} />
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 6. REQUEST TOW (Towing Request Interface)
   * ------------------------------------------------------------- */
  if (currentScreen === 'request_tow') {
    if (!auth.user) {
      return (
        <div className="flex-1 flex flex-col justify-center p-6 bg-canvas text-ink">
          <EmptyState
            icon={<Truck className="w-5 h-5" />}
            title="Sign in to request a tow"
            description="We use your verified UAE mobile number to dispatch the truck and keep you updated."
            actionLabel="Sign In"
            onAction={() => navigateTo('login')}
          />
        </div>
      );
    }
    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink">
        <div className="p-4 border-b border-line flex items-center justify-between sticky top-0 bg-surface/90 backdrop-blur-md z-10">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigateTo('home')}
              className="p-1 text-muted hover:text-ink"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h3 className="text-sm font-bold text-ink">Request Towing Service</h3>
          </div>
          <span className="text-[11px] text-navy font-semibold">Step 1 of 3</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Vehicle Selector Row */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Vehicle to Tow</label>
            <div
              onClick={() => navigateTo('vehicle_select')}
              className="p-3 rounded-xl bg-surface border border-line flex items-center justify-between cursor-pointer hover:border-line"
            >
              <div className="flex items-center gap-2.5">
                <Car className="w-4 h-4 text-navy" />
                <span className="text-xs font-semibold text-ink">
                  {selectedVehicle
                    ? `${selectedVehicle.brand} ${selectedVehicle.model} (${selectedVehicle.plateEmirate} ${selectedVehicle.plateCode} ${selectedVehicle.plateNumber})`
                    : 'Add the vehicle that needs towing'}
                </span>
              </div>
              <span className="text-xs text-navy">{selectedVehicle ? 'Change' : 'Add'}</span>
            </div>
          </div>

          {/* Locations */}
          <div className="space-y-2">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">
                Pickup Location
              </label>
              <div
                onClick={() => openLocationPicker('pickup')}
                className="p-3 rounded-xl bg-surface border border-line flex items-center gap-2.5 cursor-pointer hover:border-line"
              >
                <div className="w-2.5 h-2.5 rounded-full bg-lime shrink-0" />
                <span className="text-xs text-ink truncate">{pickupLocation.name}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">
                Drop-off Destination
              </label>
              <div
                onClick={() => openLocationPicker('dropoff')}
                className="p-3 rounded-xl bg-surface border border-line flex items-center gap-2.5 cursor-pointer hover:border-line"
              >
                <div className="w-2.5 h-2.5 rounded-full bg-success shrink-0" />
                <span className="text-xs text-ink truncate">{dropoffLocation.name}</span>
              </div>
            </div>
          </div>

          {/* Vehicle Issue Grid */}
          <div>
            <label className="block text-xs font-medium text-muted mb-2">
              Vehicle Issue (Select Primary)
            </label>
            <div className="grid grid-cols-2 gap-2">
              {issuesList.map((issue) => (
                <button
                  key={issue}
                  onClick={() => setSelectedIssue(issue)}
                  className={`p-2.5 rounded-xl border text-left text-xs font-medium transition-all ${
                    selectedIssue === issue
                      ? 'bg-lime/30 border-navy text-navy font-semibold'
                      : 'bg-surface border-line text-ink/80 hover:border-line'
                  }`}
                >
                  {issue}
                </button>
              ))}
            </div>
          </div>

          {/* Tow Truck Type Selection */}
          <div>
            <label className="block text-xs font-medium text-muted mb-2">
              Recommended Towing Equipment
            </label>
            <div className="space-y-2">
              {TOW_OPTIONS.map((truck) => {
                const fits = !selectedVehicle || towTypeFits(selectedVehicle.category, truck.type);
                const tariff = tariffFor(truck.type);
                return (
                  <div
                    key={truck.type}
                    onClick={() => fits && setSelectedTowType(truck.type)}
                    aria-disabled={!fits}
                    className={`p-3 rounded-xl border transition-all ${
                      !fits
                        ? 'bg-surface/30 border-line opacity-40 cursor-not-allowed'
                        : selectedTowType === truck.type
                        ? 'bg-surface border-navy shadow-md ring-1 ring-navy/20 cursor-pointer'
                        : 'bg-surface/60 border-line hover:border-line cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-ink">{truck.title}</span>
                      <span className="text-xs font-bold text-navy font-mono">
                        {tariff ? `From ${formatAed(tariff.baseFareFils + tariff.towTypeSurchargeFils)}` : ''}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted mt-1">
                      {fits ? truck.desc : `Not suitable for a ${selectedVehicle?.category}.`}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Additional Notes */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">
              Driver Instructions / Notes (Optional)
            </label>
            <textarea
              value={requestNotes}
              onChange={(e) => setRequestNotes(e.target.value)}
              placeholder="e.g. Car is in basement level B2, front bumper is lowered..."
              className="w-full bg-surface border border-line rounded-xl p-3 text-xs text-ink placeholder-muted focus:outline-none focus:border-navy min-h-[70px]"
            />
          </div>
        </div>

        {/* Sticky Continue CTA */}
        <div className="p-4 border-t border-line bg-surface/90 backdrop-blur-md">
          <Button
            variant="primary"
            fullWidth
            size="lg"
            disabled={!selectedVehicle || !towTypeFits(selectedVehicle.category, selectedTowType)}
            onClick={() => navigateTo('fare_estimate')}
            rightIcon={<ArrowRight className="w-4 h-4" />}
          >
            Review Fare Estimate
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 7. VEHICLE SELECTION SCREEN
   * ------------------------------------------------------------- */
  if (currentScreen === 'vehicle_select') {
    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink">
        <div className="p-4 border-b border-line flex items-center justify-between sticky top-0 bg-surface/90 backdrop-blur-md z-10">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigateTo('request_tow')}
              className="p-1 text-muted hover:text-ink"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h3 className="text-sm font-bold text-ink">My Registered Vehicles</h3>
          </div>
          <button
            onClick={() => (auth.user ? openAddVehicle() : navigateTo('login'))}
            className="text-xs text-navy font-semibold flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Vehicle</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <p className="text-xs text-muted">
            Select the vehicle requiring towing or recovery assistance:
          </p>

          {!auth.user && (
            <EmptyState
              icon={<Car className="w-5 h-5" />}
              title="Sign in to manage your vehicles"
              description="Your registered vehicles are saved to your TowNow account."
              actionLabel="Sign In"
              onAction={() => navigateTo('login')}
            />
          )}

          {vehicles.map((veh) => (
            <VehicleCard
              key={veh.id}
              vehicle={veh}
              selected={selectedVehicle?.id === veh.id}
              onSelect={() => {
                setSelectedVehicleId(veh.id);
                if (!towTypeFits(veh.category, selectedTowType)) {
                  setSelectedTowType(veh.category === 'motorbike' ? 'bike-carrier' : 'flatbed');
                }
                showToast(`Selected ${veh.brand} ${veh.model}`, 'success');
              }}
              showActions={true}
              onEdit={() => openEditVehicle(veh)}
              onDelete={() => setVehicleToRemove(veh)}
            />
          ))}

          {auth.user && (
            <button
              onClick={openAddVehicle}
              className="w-full py-4 rounded-2xl border border-dashed border-line bg-surface/40 text-ink/80 hover:text-navy hover:border-navy/50 flex items-center justify-center gap-2 text-xs font-semibold transition-colors mt-4"
            >
              <Plus className="w-4 h-4" />
              <span>Add New UAE Registered Vehicle</span>
            </button>
          )}
        </div>

        <div className="p-4 border-t border-line bg-surface/90">
          <Button variant="primary" fullWidth size="lg" onClick={() => navigateTo('request_tow')}>
            Confirm Selection
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 8. LOCATION SELECTION SCREEN (Map Pin & Search)
   * ------------------------------------------------------------- */
  if (currentScreen === 'location_select') {
    const setTarget = (loc: LocationItem) =>
      locationTarget === 'dropoff' ? setDropoffLocation(loc) : setPickupLocation(loc);
    const runPlaceSearch = async () => {
      if (placeQuery.trim().length < 3) return showToast('Type at least 3 characters.', 'info');
      try {
        const res = await searchPlaces(auth.client, placeQuery.trim());
        if (res.status === 'unavailable') showToast('Address search is not available right now. Drop a pin on the map instead.', 'info');
        else if (res.results.length === 0) showToast('No UAE address found. Try another search or drop a pin.', 'info');
        setPlaceResults(res.results);
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : 'Search failed. Check your connection.', 'error');
      }
    };
    const pinMyGps = () => {
      if (!navigator.geolocation) return showToast('This browser cannot share its location.', 'error');
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          const p = { lat: +coords.latitude.toFixed(6), lng: +coords.longitude.toFixed(6) };
          setTarget({ id: 'gps', name: 'Current location', address: `GPS ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`, city: 'Dubai', coordinates: latLngToMap(p), ...p, type: 'current' });
          showToast('Pinned to your current GPS position', 'success');
        },
        () => showToast('Location permission denied. Drop a pin on the map instead.', 'error'),
        { enableHighAccuracy: true, timeout: 10_000 },
      );
    };
    return (
      <div className="flex-1 flex flex-col bg-canvas text-ink relative">
        {/* Top Floating Search Bar */}
        <div className="absolute top-4 left-4 right-4 z-20 space-y-2">
          <div className="flex items-center gap-2 bg-surface/95 border border-line rounded-2xl p-2 shadow-2xl backdrop-blur-md">
            <button
              onClick={() => navigateTo('request_tow')}
              className="p-1 text-muted hover:text-ink"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <form className="flex-1 relative" onSubmit={(e) => { e.preventDefault(); void runPlaceSearch(); }}>
              <input
                type="search"
                placeholder="Search UAE location, highway, landmark..."
                value={placeQuery}
                onChange={(e) => setPlaceQuery(e.target.value)}
                aria-label="Search address"
                maxLength={120}
                className="w-full bg-transparent text-xs text-ink placeholder-muted outline-none"
              />
            </form>
            <button
              onClick={pinMyGps}
              className="p-1.5 rounded-lg bg-lime text-navy font-bold"
              title="Current GPS"
            >
              <Navigation className="w-3.5 h-3.5" />
            </button>
          </div>
          {placeResults.length > 0 && (
            <div className="bg-surface/95 border border-line rounded-2xl p-1 shadow-2xl max-h-56 overflow-y-auto">
              {placeResults.map((r) => (
                <button
                  key={`${r.lat},${r.lng}`}
                  onClick={() => {
                    setTarget({ id: `place-${r.lat},${r.lng}`, name: r.address.split(',')[0], address: r.address, city: 'Dubai', coordinates: latLngToMap(r), lat: r.lat, lng: r.lng });
                    setPlaceResults([]);
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-ink hover:bg-canvas"
                >
                  {r.address}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Visual Map Area */}
        <div className="flex-1 relative">
          <MapPanel
            pickup={pickupLocation}
            destination={dropoffLocation}
            showRoute={true}
            interactive={true}
            onSelectLocation={({ lat, lng }) => {
              const place: LocationItem = {
                id: `pin-${locationTarget}`,
                name: `Pinned location (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
                address: `Pinned on map at ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
                city: 'Dubai',
                coordinates: latLngToMap({ lat, lng }),
                lat,
                lng,
              };
              if (locationTarget === 'dropoff') setDropoffLocation(place);
              else setPickupLocation(place);
              showToast(`${locationTarget === 'dropoff' ? 'Drop-off' : 'Pickup'} pinned on map`, 'info');
            }}
          />
        </div>

        {/* Bottom Location Confirmation Sheet */}
        <div className="p-4 bg-surface border-t border-line z-20 space-y-3">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                locationTarget === 'dropoff'
                  ? 'bg-success/10 border-success/30 text-success'
                  : 'bg-lime/20 border-navy/20 text-navy'
              }`}
            >
              <MapPin className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[10px] text-muted uppercase font-semibold">
                {locationTarget === 'dropoff' ? 'DESTINATION' : 'PICKUP'}
              </span>
              <div className="text-xs font-semibold text-ink truncate">
                {(locationTarget === 'dropoff' ? dropoffLocation : pickupLocation).name}
              </div>
              <div className="text-[11px] text-muted truncate">
                {(locationTarget === 'dropoff' ? dropoffLocation : pickupLocation).address}
              </div>
            </div>
          </div>

          {/* Quick picks: known places with real coordinates */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {MOCK_LOCATIONS.map((loc) => (
              <button
                key={loc.id}
                onClick={() =>
                  locationTarget === 'dropoff' ? setDropoffLocation(loc) : setPickupLocation(loc)
                }
                className="px-3 py-1.5 rounded-full text-[11px] font-medium whitespace-nowrap bg-canvas border border-line text-ink/80 hover:border-navy/50"
              >
                {loc.name}
              </button>
            ))}
          </div>

          <Button
            variant="primary"
            fullWidth
            size="lg"
            onClick={() => navigateTo(auth.user ? 'fare_estimate' : 'request_tow')}
          >
            Confirm Location & Proceed
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 9. FARE ESTIMATE SCREEN (Detailed Breakdown + 5% VAT)
   * ------------------------------------------------------------- */
  if (currentScreen === 'fare_estimate') {
    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink">
        <div className="p-4 border-b border-line flex items-center justify-between sticky top-0 bg-surface/90 backdrop-blur-md z-10">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigateTo('request_tow')}
              className="p-1 text-muted hover:text-ink"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h3 className="text-sm font-bold text-ink">Trip Fare & Estimation</h3>
          </div>
          <span className="text-[11px] text-navy font-semibold">Step 2 of 3</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Trip Summary Card */}
          <div className="p-4 rounded-2xl bg-surface border border-line space-y-3">
            <div className="flex items-center justify-between text-xs pb-2 border-b border-line">
              <span className="text-muted">Selected Vehicle</span>
              <span className="font-semibold text-ink">
                {selectedVehicle ? `${selectedVehicle.brand} ${selectedVehicle.model}` : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs pb-2 border-b border-line">
              <span className="text-muted">Towing Equipment</span>
              <span className="font-semibold text-navy">
                {TOW_OPTIONS.find((o) => o.type === selectedTowType)?.title}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Estimated Distance</span>
              <span className="font-semibold text-ink font-mono">
                {quote
                  ? `${(quote.distanceMeters / 1000).toFixed(1)} km · ~${Math.max(1, Math.round(quote.estimatedDurationSeconds / 60))} min drive`
                  : '—'}
              </span>
            </div>
          </div>

          {/* Route Overview */}
          <div className="p-3.5 rounded-xl bg-surface/60 border border-line space-y-2 text-xs">
            <div className="flex items-start gap-2.5">
              <div className="w-2.5 h-2.5 rounded-full bg-lime mt-0.5 shrink-0" />
              <div>
                <span className="text-[10px] text-muted uppercase font-semibold">PICKUP</span>
                <p className="text-ink font-medium">{pickupLocation.name}</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <div className="w-2.5 h-2.5 rounded-full bg-success mt-0.5 shrink-0" />
              <div>
                <span className="text-[10px] text-muted uppercase font-semibold">
                  DESTINATION
                </span>
                <p className="text-ink font-medium">{dropoffLocation.name}</p>
              </div>
            </div>
          </div>

          {/* Itemized fare from the server quote */}
          <div className="p-4 rounded-2xl bg-surface border border-line space-y-2.5">
            <h4 className="text-xs font-bold text-ink/80 uppercase tracking-wider mb-2">
              Itemized Charges (AED)
            </h4>

            {quoteLoading && <p className="text-xs text-muted">Calculating your fare…</p>}

            {quoteError && !quoteLoading && (
              <div className="space-y-2">
                <p className="text-xs text-danger font-medium">{quoteError}</p>
                <Button variant="secondary" size="sm" onClick={() => void fetchQuote()}>
                  Try Again
                </Button>
              </div>
            )}

            {quote && !quoteLoading && (
              <>
                <div className="flex justify-between text-xs text-ink/80">
                  <span>Base Hookup Fare</span>
                  <span className="font-mono font-medium tabular-nums">{formatAed(quote.fare.baseFareFils)}</span>
                </div>
                <div className="flex justify-between text-xs text-ink/80">
                  <span>
                    Distance Charge ({(quote.distanceMeters / 1000).toFixed(1)} km
                    {tariffFor(quote.towType) && ` × ${formatAed(tariffFor(quote.towType)!.perKmFils)}`})
                  </span>
                  <span className="font-mono font-medium tabular-nums">{formatAed(quote.fare.distanceChargeFils)}</span>
                </div>
                {quote.fare.towTypeSurchargeFils > 0 && (
                  <div className="flex justify-between text-xs text-ink/80">
                    <span>{TOW_TYPE_LABELS[quote.towType] ?? 'Equipment'} surcharge</span>
                    <span className="font-mono font-medium tabular-nums">{formatAed(quote.fare.towTypeSurchargeFils)}</span>
                  </div>
                )}
                {quote.fare.nightSurchargeFils > 0 && (
                  <div className="flex justify-between text-xs text-ink/80">
                    <span>Night Surcharge (00:00–06:00)</span>
                    <span className="font-mono font-medium tabular-nums">{formatAed(quote.fare.nightSurchargeFils)}</span>
                  </div>
                )}
                {quote.fare.minimumFareAdjustmentFils > 0 && (
                  <div className="flex justify-between text-xs text-ink/80">
                    <span>Minimum Fare Adjustment</span>
                    <span className="font-mono font-medium tabular-nums">{formatAed(quote.fare.minimumFareAdjustmentFils)}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs text-muted pt-2 border-t border-line">
                  <span>Subtotal</span>
                  <span className="font-mono tabular-nums">{formatAed(quote.fare.subtotalFils)}</span>
                </div>
                <div className="flex justify-between text-xs text-muted">
                  <span>UAE Federal VAT ({quote.fare.vatRateBps / 100}%)</span>
                  <span className="font-mono tabular-nums">{formatAed(quote.fare.vatFils)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold text-ink pt-2 border-t border-line">
                  <span>Total Payable</span>
                  <span className="text-navy font-mono text-base tabular-nums">{formatAed(quote.fare.totalFils)}</span>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 p-3 rounded-xl bg-surface/50 border border-line text-[11px] text-muted">
            <Shield className="w-4 h-4 text-success shrink-0" />
            <span>Guaranteed price for 15 minutes. No hidden tolls or surprise extra charges.</span>
          </div>
        </div>

        <div className="p-4 border-t border-line bg-surface/90">
          <Button
            variant="primary"
            fullWidth
            size="lg"
            disabled={!quote}
            onClick={() => navigateTo('payment')}
            rightIcon={<ArrowRight className="w-4 h-4" />}
          >
            Select Payment Method
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 10. PAYMENT SELECTION SCREEN
   * ------------------------------------------------------------- */
  if (currentScreen === 'payment') {
    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink">
        <div className="p-4 border-b border-line flex items-center justify-between sticky top-0 bg-surface/90 backdrop-blur-md z-10">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigateTo('fare_estimate')}
              className="p-1 text-muted hover:text-ink"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h3 className="text-sm font-bold text-ink">Payment Method</h3>
          </div>
          <span className="text-[11px] text-navy font-semibold">Final Step</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Amount Callout */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-surface to-canvas border border-line text-center">
            <div className="text-[11px] text-muted uppercase font-semibold">Total Amount</div>
            <div className="text-2xl font-black text-navy font-mono mt-0.5">
              {quote ? formatAed(quote.fare.totalFils) : '—'}
            </div>
            <div className="text-[10px] text-muted">
              {quote
                ? `Includes ${quote.fare.vatRateBps / 100}% UAE VAT (${formatAed(quote.fare.vatFils)})`
                : 'Get a fare quote first'}
            </div>
          </div>

          {/* Payment Options */}
          <div className="space-y-2">
            {[
              {
                id: 'card' as PaymentMethod,
                title: 'Visa / Mastercard',
                subtitle: 'Secure card form (Stripe) · charged after the tow',
                icon: CreditCard,
              },
              {
                id: 'apple_pay' as PaymentMethod,
                title: 'Apple Pay',
                subtitle: 'One-tap biometric checkout',
                icon: Zap,
              },
              {
                id: 'cash' as PaymentMethod,
                title: 'Cash to Driver',
                subtitle: 'Pay directly on delivery',
                icon: DollarSign,
              },
            ]
              .filter((pm) => paymentOptions.includes(pm.id))
              .sort((a, b) => paymentOptions.indexOf(a.id) - paymentOptions.indexOf(b.id))
              .map((pm) => (
              <div
                key={pm.id}
                onClick={() => setPaymentMethod(pm.id)}
                className={`p-3.5 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                  paymentMethod === pm.id
                    ? 'bg-surface border-navy shadow-sm ring-1 ring-navy/20'
                    : 'bg-surface/60 border-line hover:border-line'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-canvas border border-line flex items-center justify-center text-navy">
                    <pm.icon className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-ink">{pm.title}</div>
                    <div className="text-[11px] text-muted">{pm.subtitle}</div>
                  </div>
                </div>
                {paymentMethod === pm.id && <CheckCircle2 className="w-5 h-5 text-navy" />}
              </div>
            ))}
          </div>

          <p className="text-[11px] text-muted text-center px-2">
            {paymentOptions.length > 1
              ? 'Card and Apple Pay are authorised now and charged only when your tow is completed. Card details are entered on Stripe\x27s secure form and never stored by TowNow.'
              : 'Pay your driver in cash when the tow is completed. Card payments are not available yet.'}
          </p>
        </div>

        <div className="p-4 border-t border-line bg-surface/90">
          <Button
            variant="primary"
            fullWidth
            size="lg"
            disabled={!quote}
            isLoading={bookingBusy}
            onClick={() => void confirmBooking()}
            rightIcon={<ArrowRight className="w-4 h-4" />}
          >
            Confirm & Dispatch Tow Truck
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 11. SEARCHING FOR DRIVER (Matching Animation)
   * ------------------------------------------------------------- */
  if (currentScreen === 'card_payment') {
    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink">
        <div className="p-4 border-b border-line flex items-center justify-between sticky top-0 bg-surface/90 backdrop-blur-md z-10">
          <h3 className="text-sm font-bold text-ink">Authorise Payment</h3>
          <span className="text-xs font-mono text-navy">{lastCreatedBooking?.bookingNumber ?? ''}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!lastCreatedBooking ? (
            <p className="text-xs text-muted text-center pt-8">Book a tow first, then pay here.</p>
          ) : (
            <>
              <div className="p-4 rounded-2xl bg-surface border border-line text-center">
                <div className="text-[11px] text-muted uppercase font-semibold">Amount to hold</div>
                <div className="text-2xl font-black text-navy font-mono mt-0.5">
                  {formatAed(lastCreatedBooking.fare.totalFils)}
                </div>
                <div className="text-[10px] text-muted">
                  Includes {lastCreatedBooking.fare.vatRateBps / 100}% VAT · charged when the tow is completed ·
                  released if you cancel
                </div>
              </div>
              <div ref={cardMountRef} className="min-h-[120px]" />
              {cardState === 'loading' && <p className="text-xs text-muted text-center">Loading secure payment form…</p>}
              {cardError && <p className="text-xs text-danger text-center">{cardError}</p>}
            </>
          )}
        </div>
        <div className="p-4 border-t border-line bg-surface/90 space-y-2">
          <Button
            variant="primary"
            fullWidth
            size="lg"
            isLoading={cardState === 'paying'}
            disabled={cardState !== 'ready'}
            onClick={() => void payNow()}
          >
            {lastCreatedBooking ? `Authorise ${formatAed(lastCreatedBooking.fare.totalFils)}` : 'Authorise'}
          </Button>
          {lastCreatedBooking && (
            <Button variant="ghost" fullWidth size="md" onClick={() => setIsCancelOpen(true)} className="text-danger">
              Cancel Booking
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (currentScreen === 'searching') {
    return (
      <div className="flex-1 flex flex-col justify-between items-center p-6 bg-canvas text-ink text-center select-none">
        <div className="w-full flex justify-between items-center pt-2">
          <span className="text-xs font-bold text-navy">TowNow Radar</span>
        </div>

        <div className="my-auto space-y-6 w-full max-w-xs">
          {/* Pulsing Radar Ring with Tow Truck */}
          <div className="relative w-44 h-44 mx-auto flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-navy/20 animate-ping" />
            <div className="absolute inset-4 rounded-full border border-navy/40 animate-pulse" />
            <div className="w-24 h-24 rounded-full bg-surface border-2 border-navy shadow-2xl flex items-center justify-center text-navy relative">
              <Truck className="w-10 h-10 animate-bounce" />
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-xl font-bold text-ink">
              {lastCreatedBooking?.status === 'cancelled'
                ? 'No Tow Truck Available'
                : lastCreatedBooking?.status === 'searching'
                ? 'Searching for a Tow Truck…'
                : 'Tow Request Received'}
            </h3>
            <p className="text-xs text-muted max-w-xs mx-auto">
              {lastCreatedBooking?.status === 'cancelled'
                ? lastCreatedBooking.cancellationReason ?? 'This request was cancelled.'
                : lastCreatedBooking
                ? `Request ${lastCreatedBooking.bookingNumber} · ${formatAed(lastCreatedBooking.fare.totalFils)}. We are offering it to the nearest certified tow trucks — you'll see your driver here as soon as one accepts.`
                : 'We are offering your request to the nearest certified tow trucks.'}
            </p>
          </div>

          {lastCreatedBooking?.payment &&
            ['pending', 'failed'].includes(lastCreatedBooking.payment.status) &&
            lastCreatedBooking.status === 'requested' && (
              <Button variant="primary" size="sm" onClick={() => navigateTo('card_payment')}>
                Complete Payment to Start Search
              </Button>
            )}
          {lastCreatedBooking && (
            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void openBookingDetails(lastCreatedBooking.id)}
                className="text-xs"
              >
                View Booking Details
              </Button>
            </div>
          )}
        </div>

        <div className="w-full pb-4">
          <Button
            variant="ghost"
            fullWidth
            size="md"
            onClick={() => setIsCancelOpen(true)}
            className="text-danger hover:text-danger"
          >
            Cancel Request
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 12. DRIVER FOUND SCREEN
   * ------------------------------------------------------------- */
  if (currentScreen === 'driver_found') {
    const assigned = trackedTrip ?? [lastCreatedBooking, detailBooking, activeRequest].find((b) => b?.driver) ?? null;
    if (!assigned?.driver) {
      return (
        <div className="flex-1 flex flex-col justify-center p-6">
          <EmptyState title="No driver assigned yet" description="This screen opens automatically when a driver accepts your request." />
          <Button variant="secondary" onClick={() => navigateTo('home')} className="mt-4">Back to Home</Button>
        </div>
      );
    }
    const shownDriver = toUiDriver(assigned.driver, assigned.pickup);
    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink p-4">
        <div className="flex items-center justify-between pb-2 border-b border-line">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-success" />
            <h3 className="text-sm font-bold text-ink">
              {assigned ? `${TRIP_STATUS_LABEL[assigned.status] ?? 'Driver accepted'}` : 'Driver Accepted!'}
            </h3>
          </div>
          <span className="text-xs font-mono font-bold text-navy">
            {assigned ? assigned.bookingNumber : 'Preview'}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          <DriverCard
            driver={shownDriver}
            etaText={assigned ? etaLabel(live?.eta ?? null) || '—' : undefined}
            onCall={() => showToast('Calling drivers from the app is not available yet.', 'info')}
            onChat={() => openFromCurrent('chat')}
            onViewProfile={() => openFromCurrent('driver_profile')}
            onSos={() => setIsSosSheetOpen(true)}
            onCancel={() => setIsCancelOpen(true)}
          />

          <div className="p-4 rounded-2xl bg-surface border border-line space-y-2 text-xs">
            <div className="flex justify-between text-muted">
              <span>Vehicle Assigned:</span>
              <span className="font-semibold text-ink">{shownDriver.vehicle.model}</span>
            </div>
            <div className="flex justify-between text-muted">
              <span>Plate:</span>
              <span className="font-mono text-ink font-bold">{shownDriver.vehicle.plateNumber}</span>
            </div>
            <div className="flex justify-between text-muted">
              <span>Driver location:</span>
              <span className={live?.location && !live.location.stale ? 'text-success font-medium' : 'text-navy'}>
                {assigned ? liveFreshness : '—'}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-2 pb-2">
          <Button
            variant="primary"
            fullWidth
            size="lg"
            onClick={() => navigateTo('live_tracking')}
            rightIcon={<ArrowRight className="w-4 h-4" />}
          >
            Open Live Map Tracking
          </Button>
          <Button
            variant="outline"
            fullWidth
            size="md"
            onClick={() => navigateTo('trip_status')}
          >
            View Trip Progress Steps
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 13. LIVE TRACKING SCREEN (Full-Screen Map + Bottom Card)
   * ------------------------------------------------------------- */
  if (currentScreen === 'live_tracking') {
    if (!trackedTrip?.driver) {
      return (
        <div className="flex-1 flex flex-col justify-center items-center p-6 bg-canvas text-ink text-center space-y-3">
          <Truck className="w-10 h-10 text-muted" />
          <h2 className="text-lg font-bold">No tow to track right now</h2>
          <p className="text-xs text-muted max-w-xs">Live tracking starts once a driver accepts your request.</p>
          <Button variant="primary" size="md" onClick={() => navigateTo('home')}>
            Back to Home
          </Button>
        </div>
      );
    }
    const tripDriver = toUiDriver(trackedTrip.driver, trackedTrip.pickup);
    const fix = live?.location;
    return (
      <div className="flex-1 flex flex-col bg-canvas text-ink relative">
        {/* Top Floating App Bar */}
        <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none">
          <button
            onClick={() => navigateTo('home')}
            aria-label="Back to home"
            className="pointer-events-auto p-2.5 rounded-xl bg-surface/90 border border-line text-ink backdrop-blur-md shadow-lg"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface/90 border border-line backdrop-blur-md shadow-lg text-xs">
            <span
              className={`w-2 h-2 rounded-full ${fix && !fix.stale ? 'bg-success animate-ping' : 'bg-lime'}`}
            />
            <span className="font-bold text-ink">{fix && !fix.stale ? 'Live GPS Tracking' : 'GPS signal pending'}</span>
          </div>
          <button
            onClick={() => setIsSosSheetOpen(true)}
            aria-label="SOS"
            className="pointer-events-auto p-2.5 rounded-xl bg-danger/10 border border-danger text-danger backdrop-blur-md shadow-lg"
          >
            <AlertOctagon className="w-4 h-4 text-danger" />
          </button>
        </div>

        <div className="flex-1 relative">
          <MapPanel
            pickup={toUiPlace('pickup', trackedTrip.pickup)}
            destination={toUiPlace('dropoff', trackedTrip.dropoff)}
            driver={fix ? withLiveLocation(tripDriver, fix) : undefined}
            towType={trackedTrip.towType}
            showRoute={true}
            etaText={etaLabel(live?.eta ?? null) || '—'}
            interactive={true}
          />
        </div>

        <div className="p-4 bg-surface border-t border-line z-20 space-y-3">
          <div className="flex items-center justify-between">
            <div onClick={() => openFromCurrent('driver_profile')} className="flex items-center gap-3 cursor-pointer">
              <Avatar name={tripDriver.name} size="md" />
              <div>
                <h4 className="text-xs font-bold text-ink">
                  {tripDriver.name} · {tripDriver.rating > 0 ? `★ ${tripDriver.rating.toFixed(1)}` : 'New'} ·{' '}
                  {tripDriver.totalTrips} tows
                </h4>
                <div className="text-[11px] text-muted">
                  {tripDriver.vehicle.model} · {tripDriver.vehicle.plateNumber}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold text-navy font-mono">{etaLabel(live?.eta ?? null) || '—'}</div>
              <div className="text-[10px] text-muted">{TRIP_STATUS_LABEL[trackedTrip.status]}</div>
            </div>
          </div>
          <div className={`text-[11px] ${fix && !fix.stale ? 'text-muted' : 'text-navy'}`}>{liveFreshness}</div>

          <div className="grid grid-cols-3 gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => showToast('Calling drivers from the app is not available yet.', 'info')}
              leftIcon={<Phone className="w-3.5 h-3.5 text-success" />}
            >
              Call
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openFromCurrent('chat')}
              leftIcon={<MessageSquare className="w-3.5 h-3.5 text-info" />}
            >
              Chat
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => navigateTo('trip_status')}
              rightIcon={<ChevronRight className="w-3.5 h-3.5" />}
            >
              Trip Status
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 14. TRIP STATUS PROGRESSION SCREEN  /* -------------------------------------------------------------
   * 14. TRIP STATUS PROGRESSION SCREEN
   * ------------------------------------------------------------- */
  if (currentScreen === 'trip_status') {
    const trip = trackedTrip ?? (completedTrip?.driver ? completedTrip : null);
    const order = ['driver_assigned', 'driver_arriving', 'driver_arrived', 'in_transit', 'completed'];
    const at = trip ? order.indexOf(trip.status === 'vehicle_loaded' ? 'driver_arrived' : trip.status) : -1;
    const driverName = trip?.driver?.firstName ?? 'Your driver';
    const steps = [
      { label: BOOKING_STATUS_LABELS.driver_assigned, desc: `${driverName} accepted your request` },
      { label: BOOKING_STATUS_LABELS.driver_arriving, desc: `Heading to ${trip?.pickup.address ?? 'your location'}` },
      { label: BOOKING_STATUS_LABELS.driver_arrived, desc: 'On scene — inspecting your vehicle before loading' },
      { label: BOOKING_STATUS_LABELS.in_transit, desc: `Towing to ${trip?.dropoff.address ?? 'your destination'}` },
      { label: BOOKING_STATUS_LABELS.completed, desc: 'Vehicle delivered and inspected on hand-over' },
    ];

    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink">
        <div className="p-4 border-b border-line flex items-center justify-between sticky top-0 bg-surface/90 backdrop-blur-md z-10">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigateTo('live_tracking')}
              aria-label="Back to live tracking"
              className="p-1 text-muted hover:text-ink"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h3 className="text-sm font-bold text-ink">Trip Progress</h3>
          </div>
          <span className="text-xs font-mono font-bold text-navy">{trip?.bookingNumber ?? ''}</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!trip && (
            <div className="p-3 rounded-xl bg-surface/50 border border-line text-center text-xs text-muted">
              Progress appears here once a driver accepts your request.
            </div>
          )}
          {steps.map((st, i) => {
            const isPast = at > i || (at === i && i === steps.length - 1);
            const isCurrent = at === i && i < steps.length - 1;
            return (
              <div
                key={st.label}
                className={`flex items-start gap-3 p-3 rounded-xl border ${
                  isCurrent
                    ? 'bg-surface border-navy shadow-md ring-1 ring-navy/20'
                    : isPast
                      ? 'bg-surface/40 border-line'
                      : 'bg-transparent border-line opacity-60'
                }`}
              >
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-bold text-xs ${
                    isPast
                      ? 'bg-success text-navy'
                      : isCurrent
                        ? 'bg-lime text-navy animate-pulse'
                        : 'bg-canvas text-muted'
                  }`}
                >
                  {isPast ? '✓' : i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h4
                      className={`text-xs font-bold ${isCurrent ? 'text-navy' : isPast ? 'text-ink' : 'text-muted'}`}
                    >
                      {st.label}
                    </h4>
                    {isCurrent && (
                      <span className="text-[10px] text-navy font-semibold bg-lime/20 px-2 py-0.5 rounded">
                        Now
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted mt-0.5">{st.desc}</p>
                </div>
              </div>
            );
          })}
          {trip && trip.status !== 'completed' && (
            <div className="p-3 rounded-xl bg-surface/50 border border-line text-xs text-muted flex justify-between">
              <span>{etaLabel(live?.eta ?? null) || 'ETA —'}</span>
              <span>{liveFreshness}</span>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-line bg-surface/90 space-y-2">
          <Button variant="outline" fullWidth size="md" onClick={() => navigateTo('live_tracking')}>
            Back to Map Tracking
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 15. COMPLETION & INVOICE SCREEN  /* -------------------------------------------------------------
   * 15. COMPLETION & INVOICE SCREEN
   * ------------------------------------------------------------- */
  if (currentScreen === 'completion') {
    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink p-4">
        <div className="text-center pt-4 pb-2">
          <div className="w-14 h-14 rounded-2xl bg-success/10 border border-success/30 text-success flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-ink">Towing Completed!</h2>
          <p className="text-xs text-muted mt-0.5">
            Your vehicle has been safely delivered to {completedTrip ? completedTrip.dropoff.address : 'your destination'}.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto py-3 space-y-3">
          {/* Invoice Summary Box */}
          <div className="p-4 rounded-2xl bg-surface border border-line space-y-3">
            <div className="flex justify-between items-center pb-2 border-b border-line text-xs">
              <span className="text-muted">Booking Number</span>
              <span className="font-mono font-bold text-navy">
                {completedTrip ? completedTrip.bookingNumber : '—'}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted">Payment Status</span>
              <span className="text-success font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>
                  {completedTrip
                    ? `${paymentLabels[completedTrip.paymentMethod]} · ${
                        completedTrip.payment
                          ? PAYMENT_STATUS_LABELS[completedTrip.payment.status]
                          : completedTrip.paymentMethod === 'cash'
                            ? 'pay the driver in cash'
                            : 'processing'
                      }`
                    : paymentMethod === 'cash'
                      ? 'Cash collected by driver'
                      : `Paid via ${paymentLabels[paymentMethod]}`}
                </span>
              </span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted">UAE TRN (Tax Reg No)</span>
              <span className="font-mono text-ink/80">{invoice?.seller.trn ?? 'Not registered'}</span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-line text-sm font-bold text-ink">
              <span>{completedTrip && completedTrip.payment?.status !== 'captured' ? 'Total Payable' : 'Total Paid'}</span>
              <span className="text-navy font-mono text-base tabular-nums">
                {completedTrip ? formatAed(completedTrip.fare.totalFils) : '—'}
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowInvoiceModal(true)}
              leftIcon={<FileText className="w-3.5 h-3.5 text-navy" />}
            >
              {invoice ? invoice.title : 'Tax Invoice'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (!invoice) return showToast('The receipt is issued when the tow is completed.', 'info');
                const text = invoiceText(invoice, paymentLabels[invoice.paymentMethod]);
                try {
                  if (navigator.share) await navigator.share({ title: `TowNow ${invoice.invoiceNumber}`, text });
                  else {
                    await navigator.clipboard.writeText(text);
                    showToast('Receipt copied — paste it into WhatsApp or email.', 'success');
                  }
                } catch (err) {
                  if ((err as Error).name !== 'AbortError') showToast('Could not share the receipt.', 'error');
                }
              }}
              leftIcon={<Share2 className="w-3.5 h-3.5 text-info" />}
            >
              Share Receipt
            </Button>
          </div>
        </div>

        <div className="pb-2 space-y-2">
          <Button
            variant="primary"
            fullWidth
            size="lg"
            onClick={() => navigateTo('rating')}
            rightIcon={<Star className="w-4 h-4 fill-navy" />}
          >
            Rate Towing Partner
          </Button>
          {completedTrip?.driver && (
            <Button variant="ghost" fullWidth size="md" onClick={() => openDispute(completedTrip)}>
              Report a problem
            </Button>
          )}
          <Button variant="ghost" fullWidth size="md" onClick={() => navigateTo('home')}>
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 16. DRIVER RATING & FEEDBACK SCREEN
   * ------------------------------------------------------------- */
  if (currentScreen === 'rating') {
    const feedbackTags = [
      'Super Fast Arrival',
      'Careful Handling',
      'Professional Driver',
      'Safe Wheel Straps',
      'Friendly Service',
      'Great Clean Truck',
    ];

    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink p-4">
        <div className="p-2 flex items-center justify-between">
          <button
            onClick={() => navigateTo('completion')}
            className="p-1 text-muted hover:text-ink"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h3 className="text-sm font-bold text-ink">Rate Your Experience</h3>
          <div className="w-6" />
        </div>

        <div className="flex-1 overflow-y-auto py-4 space-y-5 text-center">
          <Avatar name={tripDriver?.name ?? 'Driver'} size="xl" className="mx-auto" />
          <div>
            <h3 className="text-base font-bold text-ink">{tripDriver?.name ?? 'Your driver'}</h3>
            <p className="text-xs text-muted">TowNow Certified Recovery Specialist</p>
          </div>

          {/* 5 Star Selector */}
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => setRatingStars(star)}
                className="p-1 transition-transform hover:scale-110 active:scale-95"
              >
                <Star
                  className={`w-8 h-8 ${
                    ratingStars >= star
                      ? 'fill-warning text-warning'
                      : 'text-line'
                  }`}
                />
              </button>
            ))}
          </div>

          {/* Quick Feedback Tags */}
          <div className="space-y-2 text-left">
            <label className="block text-xs font-semibold text-muted text-center">
              What did you like the most?
            </label>
            <div className="flex flex-wrap gap-2 justify-center">
              {feedbackTags.map((tag) => {
                const isSelected = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => {
                      if (isSelected) {
                        setSelectedTags((prev) => prev.filter((t) => t !== tag));
                      } else {
                        setSelectedTags((prev) => [...prev, tag]);
                      }
                    }}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      isSelected
                        ? 'bg-lime text-navy font-semibold'
                        : 'bg-surface border border-line text-ink/80 hover:border-line'
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Comment Box */}
          <div className="text-left">
            <label className="block text-xs font-medium text-muted mb-1">
              Add a Comment (Optional)
            </label>
            <textarea
              value={ratingComment}
              onChange={(e) => setRatingComment(e.target.value)}
              placeholder={`Tell us how ${tripDriver?.name ?? 'your driver'} took care of your vehicle...`}
              className="w-full bg-surface border border-line rounded-xl p-3 text-xs text-ink placeholder-muted focus:outline-none focus:border-navy min-h-[70px]"
            />
          </div>
        </div>

        <div className="pb-2">
          <Button
            variant="primary"
            fullWidth
            size="lg"
            disabled={!completedTrip || !!completedTrip.myRating}
            isLoading={ratingBusy}
            onClick={async () => {
              if (!completedTrip) return;
              setRatingBusy(true);
              try {
                const rated = await rateBooking(auth.client, completedTrip.id, ratingStars, buildRatingComment(selectedTags, ratingComment));
                setCompletedTrip(rated);
                showToast('Thanks — your rating was saved.', 'success');
                navigateTo('home');
              } catch (err) {
                showToast(err instanceof ApiError ? err.message : 'Could not save your rating. Check your connection.', 'error');
              } finally {
                setRatingBusy(false);
              }
            }}
          >
            {completedTrip?.myRating ? `You rated this tow ${completedTrip.myRating.rating}★` : 'Submit Review'}
          </Button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 17. MY ORDERS SCREEN (Active / Completed / Cancelled)
   * ------------------------------------------------------------- */
  if (currentScreen === 'orders') {
    const customerInfo = { id: auth.user?.id ?? '', name: signedInName ?? '', phone: auth.user?.phone ?? '' };
    const allOrders = bookings.map((b) => toUiBooking(b, customerInfo));
    const tabOf = (bk: Booking) =>
      bk.status === 'completed' ? 'completed' : bk.status === 'cancelled' ? 'cancelled' : 'active';
    const visibleOrders = allOrders.filter((bk) => tabOf(bk) === ordersTab);
    const count = (tab: string) => allOrders.filter((bk) => tabOf(bk) === tab).length;
    const emptyCopy = {
      active: { title: 'No active tow requests', desc: 'When you request a tow, you can track it here.' },
      completed: { title: 'No completed tows yet', desc: 'Your finished towing trips and invoices will appear here.' },
      cancelled: { title: 'No cancelled requests', desc: 'Requests you cancel will be listed here.' },
    }[ordersTab];

    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink">
        <div className="p-4 border-b border-line sticky top-0 bg-surface/90 backdrop-blur-md z-10 space-y-3">
          <h2 className="text-base font-bold text-ink">My Towing Requests</h2>
          <Tabs
            tabs={[
              { id: 'active', label: 'Active', badge: count('active') },
              { id: 'completed', label: 'Completed', badge: count('completed') },
              { id: 'cancelled', label: 'Cancelled', badge: count('cancelled') },
            ]}
            activeTab={ordersTab}
            onChange={(id) => setOrdersTab(id as typeof ordersTab)}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 pb-20">
          {!auth.user ? (
            <EmptyState
              icon={<Truck className="w-5 h-5" />}
              title="Sign in to see your tow requests"
              description="Your bookings are saved to your TowNow account."
              actionLabel="Sign In"
              onAction={() => navigateTo('login')}
            />
          ) : bookingsLoading && bookings.length === 0 ? (
            <p className="text-xs text-muted text-center py-8">Loading your tow requests…</p>
          ) : visibleOrders.length === 0 ? (
            <EmptyState
              icon={<Truck className="w-5 h-5" />}
              title={emptyCopy.title}
              description={emptyCopy.desc}
              actionLabel={ordersTab === 'active' ? 'Request a Tow' : undefined}
              onAction={() => navigateTo('request_tow')}
            />
          ) : (
            visibleOrders.map((bk) => (
              <BookingCard
                key={bk.id}
                booking={bk}
                onClick={() => void openBookingDetails(bk.id)}
              />
            ))
          )}
        </div>

        <CustomerBottomNav activeTab={bottomNavTab} onChangeTab={handleBottomNavChange} unreadNotifications={inbox?.unread ?? 0} />
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 18. ORDER DETAILS SCREEN
   * ------------------------------------------------------------- */
  if (currentScreen === 'order_details') {
    if (!detailBooking) {
      return (
        <div className="flex-1 flex flex-col justify-center p-6 bg-canvas text-ink">
          <EmptyState
            icon={<FileText className="w-5 h-5" />}
            title="No booking selected"
            description="Open a tow request from My Orders to see its details."
            actionLabel="My Orders"
            onAction={() => navigateTo('orders')}
          />
        </div>
      );
    }
    const booking = toUiBooking(detailBooking, {
      id: auth.user?.id ?? '',
      name: signedInName ?? '',
      phone: auth.user?.phone ?? '',
    });
    const tracking = ['driver_assigned', 'driver_arriving', 'driver_arrived', 'vehicle_loaded', 'in_transit'].includes(
      detailBooking.status,
    );

    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink">
        <div className="p-4 border-b border-line flex items-center justify-between sticky top-0 bg-surface/90 backdrop-blur-md z-10">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigateTo('orders')}
              className="p-1 text-muted hover:text-ink"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h3 className="text-sm font-bold text-ink">Order #{booking.bookingNumber}</h3>
          </div>
          <StatusBadge status={booking.status} />
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Vehicle & Tow Info */}
          <div className="p-4 rounded-2xl bg-surface border border-line space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted">Date & Time</span>
              <span className="text-ink font-mono">{booking.createdAt}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Vehicle</span>
              <span className="font-semibold text-ink">
                {booking.vehicle.brand} {booking.vehicle.model} ({booking.vehicle.plateNumber})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Reported Issue</span>
              <span className="text-navy font-medium">{booking.issue}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Towing Equipment</span>
              <span className="capitalize text-ink">{booking.towType}</span>
            </div>
          </div>

          {/* Route */}
          <div className="p-4 rounded-2xl bg-surface border border-line space-y-2 text-xs">
            <div className="flex items-start gap-2.5">
              <div className="w-2.5 h-2.5 rounded-full bg-lime mt-1" />
              <div>
                <span className="text-[10px] text-muted uppercase font-semibold">PICKUP</span>
                <p className="font-medium text-ink">{booking.pickup.name}</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 pt-2 border-t border-line">
              <div className="w-2.5 h-2.5 rounded-full bg-success mt-1" />
              <div>
                <span className="text-[10px] text-muted uppercase font-semibold">
                  DESTINATION
                </span>
                <p className="font-medium text-ink">{booking.destination.name}</p>
              </div>
            </div>
          </div>

          {/* Driver Assigned */}
          {booking.driver && (
            <div className="p-4 rounded-2xl bg-surface border border-line flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar src={booking.driver.avatar} name={booking.driver.name} size="md" />
                <div>
                  <h4 className="text-xs font-bold text-ink">{booking.driver.name}</h4>
                  <div className="text-[11px] text-muted">
                    {booking.driver.vehicle.model} · {booking.driver.vehicle.plateNumber}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 text-navy text-xs font-bold">
                <Star className="w-3.5 h-3.5 fill-warning" />
                <span>{booking.driver.rating.toFixed(2)}</span>
              </div>
            </div>
          )}

          {detailBooking.status === 'cancelled' && (
            <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-xs text-danger">
              Cancelled{detailBooking.cancellationReason ? `: ${detailBooking.cancellationReason}` : ''}
            </div>
          )}

          {/* Financial Breakdown */}
          <div className="p-4 rounded-2xl bg-surface border border-line space-y-2 text-xs">
            <div className="flex justify-between text-muted">
              <span>Base Fare</span>
              <span className="font-mono tabular-nums">AED {booking.fareBreakdown.baseFare.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-muted">
              <span>Distance Charge</span>
              <span className="font-mono tabular-nums">
                AED {booking.fareBreakdown.distanceCharge.toFixed(2)}
              </span>
            </div>
            {booking.fareBreakdown.towTypeCharge > 0 && (
              <div className="flex justify-between text-muted">
                <span>Tow Type Surcharge</span>
                <span className="font-mono tabular-nums">AED {booking.fareBreakdown.towTypeCharge.toFixed(2)}</span>
              </div>
            )}
            {booking.fareBreakdown.additionalCharges > 0 && (
              <div className="flex justify-between text-muted">
                <span>Night / Minimum Fare</span>
                <span className="font-mono tabular-nums">AED {booking.fareBreakdown.additionalCharges.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-muted">
              <span>UAE VAT ({detailBooking.fare.vatRateBps / 100}%)</span>
              <span className="font-mono tabular-nums">AED {booking.fareBreakdown.vat.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold text-ink pt-2 border-t border-line text-sm">
              <span>Total Amount</span>
              <span className="text-navy font-mono tabular-nums">
                AED {booking.fareBreakdown.total.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-line bg-surface/90 flex gap-2">
          <Button
            variant="outline"
            fullWidth
            size="md"
            onClick={() => setShowInvoiceModal(true)}
            leftIcon={<FileText className="w-4 h-4 text-navy" />}
          >
            Download Invoice
          </Button>
          {tracking && (
            <Button
              variant="primary"
              fullWidth
              size="md"
              onClick={() => navigateTo('live_tracking')}
            >
              Track Active Tow
            </Button>
          )}
          {detailBooking.canCancel && (
            <Button
              variant="ghost"
              fullWidth
              size="md"
              onClick={() => setIsCancelOpen(true)}
              className="text-danger hover:text-danger"
            >
              Cancel Request
            </Button>
          )}
        </div>
        {(detailBooking.status === 'completed' || detailBooking.driver) && (
          <div className="px-4 pb-4 bg-surface/90 flex gap-2">
            {detailBooking.status === 'completed' && !detailBooking.myRating && (
              <Button
                variant="secondary"
                fullWidth
                size="md"
                onClick={() => {
                  setCompletedTrip(detailBooking);
                  navigateTo('rating');
                }}
                leftIcon={<Star className="w-4 h-4" />}
              >
                Rate this tow
              </Button>
            )}
            {detailBooking.driver && (
              <Button variant="ghost" fullWidth size="md" onClick={() => openDispute(detailBooking)}>
                Report a problem
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 19. NOTIFICATIONS SCREEN
   * ------------------------------------------------------------- */
  if (currentScreen === 'disputes') {
    const DISPUTE_STATUS: Record<Dispute['status'], string> = { open: 'Open', resolved: 'Resolved', rejected: 'Rejected' };
    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink">
        <div className="p-4 border-b border-line sticky top-0 bg-surface/90 backdrop-blur-md z-10 flex items-center gap-2">
          <button onClick={() => navigateTo('profile')} className="p-1 text-muted hover:text-ink" aria-label="Back">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-base font-bold text-ink">My disputes</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5 pb-20">
          {!auth.user ? (
            <EmptyState title="Sign in to see your disputes" description="Problems you reported and TowNow's decisions appear here." />
          ) : !myDisputes ? (
            <Skeleton className="h-16 w-full rounded-2xl" />
          ) : myDisputes.length === 0 ? (
            <EmptyState title="No disputes" description="To report a problem, open the tow in My tows and choose Report a problem." />
          ) : myDisputes.map((d) => (
            <div key={d.id} className="p-3.5 rounded-2xl bg-surface border border-line space-y-1.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="font-mono font-bold text-navy">{d.bookingNumber}</span>
                <span className={d.status === 'open' ? 'text-navy' : d.status === 'resolved' ? 'text-success' : 'text-danger'}>
                  {DISPUTE_STATUS[d.status]}
                </span>
              </div>
              <p className="text-ink/80">{d.reason}</p>
              {d.resolution && <p className="text-muted"><span className="font-semibold">TowNow: </span>{d.resolution}</p>}
              <div className="text-[10px] text-muted">{new Date(d.createdAt).toLocaleString('en-GB')}</div>
            </div>
          ))}
        </div>
        <CustomerBottomNav activeTab={bottomNavTab} onChangeTab={handleBottomNavChange} unreadNotifications={inbox?.unread ?? 0} />
      </div>
    );
  }

  if (currentScreen === 'notifications') {
    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink">
        <div className="p-4 border-b border-line sticky top-0 bg-surface/90 backdrop-blur-md z-10 flex justify-between items-center">
          <h2 className="text-base font-bold text-ink">Notifications</h2>
          <button
            onClick={() =>
              markAllRead(auth.client)
                .then(() => {
                  setInbox((prev) => prev && { ...prev, unread: 0, items: prev.items.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) });
                  showToast('All notifications marked as read', 'success');
                })
                .catch(() => showToast('Could not update notifications. Check your connection.', 'error'))
            }
            disabled={!inbox?.unread}
            className="text-xs text-navy font-medium disabled:text-muted"
          >
            Mark all read
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2.5 pb-20">
          {!auth.user ? (
            <EmptyState title="Sign in to see notifications" description="Trip updates, receipts and support replies appear here." />
          ) : !inbox ? (
            <Skeleton className="h-16 w-full rounded-2xl" />
          ) : inbox.items.length === 0 ? (
            <EmptyState title="No notifications yet" description="Trip updates, receipts and support replies appear here." />
          ) : inbox.items.map((n) => (
            <div
              key={n.id}
              className={`p-3.5 rounded-2xl border transition-colors ${
                !n.readAt
                  ? 'bg-surface border-navy/40'
                  : 'bg-surface/50 border-line'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-xs font-bold text-ink">{n.title}</h4>
                <span className="text-[10px] text-muted">{timeAgo(n.createdAt)}</span>
              </div>
              <p className="text-[11px] text-muted mt-1">{n.body}</p>
            </div>
          ))}
        </div>

        <CustomerBottomNav activeTab={bottomNavTab} onChangeTab={handleBottomNavChange} unreadNotifications={inbox?.unread ?? 0} />
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 20. CUSTOMER PROFILE SCREEN
   * ------------------------------------------------------------- */
  if (currentScreen === 'profile') {
    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink">
        <div className="p-4 border-b border-line sticky top-0 bg-surface/90 backdrop-blur-md z-10">
          <h2 className="text-base font-bold text-ink">Customer Profile</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-20">
          {/* User Profile Card */}
          {auth.user ? (
            <div className="p-4 rounded-2xl bg-surface border border-line flex items-center gap-3">
              <Avatar name={signedInName ?? ''} size="lg" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-ink truncate">{signedInName}</h3>
                <p className="text-xs text-muted">{displayPhone(formatLocal(auth.user.phone))}</p>
                <p className="text-[11px] text-muted truncate">
                  {auth.user.email ?? 'No email added'}
                </p>
              </div>
              <button
                onClick={openEditProfile}
                className="text-xs text-navy font-semibold hover:underline shrink-0"
              >
                Edit
              </button>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-surface border border-line flex items-center gap-3">
              <Avatar name="Guest" size="lg" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-ink">
                  {auth.status === 'checking' ? 'Checking your session…' : 'You are browsing as a guest'}
                </h3>
                <p className="text-[11px] text-muted">
                  Sign in with your UAE mobile number to save your profile.
                </p>
              </div>
              {auth.status === 'signedOut' && (
                <Button variant="primary" size="sm" onClick={() => navigateTo('login')}>
                  Sign In
                </Button>
              )}
            </div>
          )}

          {/* Menu Items */}
          <div className="p-2 rounded-2xl bg-surface border border-line divide-y divide-line text-xs">
            {[
              { label: 'My vehicles', action: () => navigateTo('vehicle_select') },
              { label: 'My tows', action: () => navigateTo('orders') },
              { label: 'Notifications', action: () => navigateTo('notifications') },
              { label: 'My disputes', action: () => navigateTo('disputes') },
              ...(SUPPORT_PHONE
                ? [{ label: `Call TowNow support (${SUPPORT_PHONE})`, action: () => (window.location.href = `tel:${SUPPORT_PHONE}`) }]
                : []),
              { label: 'Emergency (Police) 999', action: () => (window.location.href = 'tel:999') },
            ].map((item, idx) => (
              <button
                key={idx}
                onClick={item.action}
                className="w-full flex items-center justify-between p-3 text-ink/80 hover:text-ink hover:bg-canvas/50 transition-colors text-left"
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
              Log Out of TowNow
            </Button>
          )}
        </div>

        <CustomerBottomNav activeTab={bottomNavTab} onChangeTab={handleBottomNavChange} unreadNotifications={inbox?.unread ?? 0} />
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 21. IN-APP CHAT WITH DRIVER
   * ------------------------------------------------------------- */
  if (currentScreen === 'chat') {
    // ponytail: no chat API yet (chat_messages table only) — add GET/POST /bookings/:id/messages before enabling input

    return (
      <div className="flex-1 flex flex-col bg-canvas text-ink">
        <div className="p-4 border-b border-line flex items-center justify-between sticky top-0 bg-surface/90 backdrop-blur-md z-10">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => navigateTo(returnScreen)}
              className="p-1 text-muted hover:text-ink"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div
              onClick={() => navigateTo('driver_profile')}
              className="flex items-center gap-2.5 min-w-0 cursor-pointer"
            >
              <Avatar name={tripDriver?.name ?? 'Driver'} size="sm" />
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-ink truncate">{tripDriver?.name ?? 'No driver assigned'}</h3>
                <div className="text-[11px] text-success">{shownTrip ? TRIP_STATUS_LABEL[shownTrip.status] : ''}</div>
              </div>
            </div>
          </div>
          <button
            onClick={() => showToast('Calling drivers from the app is not available yet.', 'info')}
            className="p-2 rounded-xl bg-canvas border border-line text-success hover:bg-line/80"
            title="Call driver"
          >
            <Phone className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          <EmptyState
            title="In-app chat is not available yet"
            description={`Your driver gets live updates of your booking${shownTrip ? ` ${shownTrip.bookingNumber}` : ''}. For anything urgent, call UAE emergency 999.`}
          />
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 22. DRIVER PROFILE
   * ------------------------------------------------------------- */
  if (currentScreen === 'driver_profile') {
    if (!tripDriver) {
      return (
        <div className="flex-1 flex flex-col justify-center p-6">
          <EmptyState title="No driver assigned" description="Driver details appear once a driver accepts your request." />
          <Button variant="secondary" onClick={() => navigateTo(returnScreen)} className="mt-4">Back</Button>
        </div>
      );
    }
    const driver = tripDriver;
    const truckLabel = TOW_TYPE_LABELS[driver.vehicle.type] ?? driver.vehicle.type;

    return (
      <div className="flex-1 flex flex-col justify-between bg-canvas text-ink">
        <div className="p-4 border-b border-line flex items-center justify-between sticky top-0 bg-surface/90 backdrop-blur-md z-10">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigateTo(returnScreen)}
              className="p-1 text-muted hover:text-ink"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h3 className="text-sm font-bold text-ink">Driver Profile</h3>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="p-5 rounded-2xl bg-surface border border-line text-center space-y-2">
            <Avatar name={driver.name} size="xl" className="mx-auto" />
            <div className="flex items-center justify-center gap-1.5">
              <h3 className="text-base font-bold text-ink">{driver.name}</h3>
              <ShieldCheck className="w-4 h-4 text-success" />
            </div>
            <p className="text-xs text-muted">TowNow Certified Recovery Specialist</p>
            <div className="grid grid-cols-2 gap-2 pt-2">
              {[
                { label: 'Rating', value: driver.rating ? driver.rating.toFixed(2) : 'New' },
                { label: 'Tows', value: driver.totalTrips.toLocaleString() },
              ].map((s) => (
                <div key={s.label} className="p-2.5 rounded-xl bg-canvas/70 border border-line">
                  <div className="text-sm font-bold text-navy tabular-nums">{s.value}</div>
                  <div className="text-[10px] text-muted uppercase tracking-wider">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-surface border border-line space-y-2 text-xs">
            <h4 className="text-xs font-bold text-ink/80 uppercase tracking-wider mb-2">
              Tow Truck
            </h4>
            <div className="flex justify-between">
              <span className="text-muted">Type</span>
              <span className="font-semibold text-ink">{truckLabel}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Model</span>
              <span className="text-ink">
                {driver.vehicle.model}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Plate</span>
              <span className="font-mono font-bold text-ink">{driver.vehicle.plateNumber}</span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-surface border border-line space-y-2 text-xs">
            <h4 className="text-xs font-bold text-ink/80 uppercase tracking-wider mb-2">
              Verification
            </h4>
            <div className="flex justify-between">
              <span className="text-muted">TowNow KYC</span>
              <span className="text-success font-medium capitalize">{driver.kycStatus}</span>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-line bg-surface/90 grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={() => showToast('Calling drivers from the app is not available yet.', 'info')}
            leftIcon={<Phone className="w-4 h-4 text-success" />}
          >
            Call
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => navigateTo('chat')}
            leftIcon={<MessageSquare className="w-4 h-4" />}
          >
            Chat
          </Button>
        </div>
      </div>
    );
  }

  // Fallback
  return (
    <div className="p-6 text-center text-muted">
      <p>Screen not found: {currentScreen}</p>
      <Button onClick={() => navigateTo('home')} className="mt-4">
        Return Home
      </Button>
    </div>
  );
  };

  const invoiceBooking =
    currentScreen === 'order_details' && detailBooking
      ? toUiBooking(detailBooking, {
          id: auth.user?.id ?? '',
          name: signedInName ?? 'TowNow Customer',
          phone: auth.user?.phone ?? '',
        })
      : null;

  const downloadInvoice = () => {
    if (invoice) {
      const url = URL.createObjectURL(new Blob([invoiceText(invoice, paymentLabels[invoice.paymentMethod])], { type: 'text/plain' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `TowNow-${invoice.invoiceNumber}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`${invoice.title} downloaded`, 'success');
      return;
    }
    if (!invoiceBooking) {
      showToast('The receipt is issued when the tow is completed.', 'info');
      return;
    }
    const b = invoiceBooking;
    const f = b.fareBreakdown;
    const lines = [
      'TowNow — Booking summary (not an invoice; the receipt is issued when the tow is completed)',
      '',
      `Booking: ${b.bookingNumber}`,
      `Date: ${b.createdAt}`,
      `Customer: ${b.customer.name} (${b.customer.phone})`,
      `Vehicle: ${b.vehicle.brand} ${b.vehicle.model} (${b.vehicle.plateEmirate} ${b.vehicle.plateCode} ${b.vehicle.plateNumber})`,
      `Pickup: ${b.pickup.name}`,
      `Destination: ${b.destination.name}`,
      '',
      `Base Fare: AED ${f.baseFare.toFixed(2)}`,
      `Distance Charge: AED ${f.distanceCharge.toFixed(2)}`,
      `Tow Type Charge: AED ${f.towTypeCharge.toFixed(2)}`,
      `Subtotal: AED ${f.subtotal.toFixed(2)}`,
      `VAT (5%): AED ${f.vat.toFixed(2)}`,
      `Total: AED ${f.total.toFixed(2)}`,
      `Payment: ${paymentLabels[b.paymentMethod]}`,
    ];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `TowNow-Booking-${b.bookingNumber}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Booking summary downloaded', 'success');
  };

  return (
    <>
      {renderScreen()}

      {/* SOS / Emergency Sheet */}
      <BottomSheet
        isOpen={isSosSheetOpen}
        onClose={() => setIsSosSheetOpen(false)}
        title="Emergency SOS"
      >
        <div className="space-y-3">
          <p className="text-xs text-muted">
            If anyone is injured or in danger, call UAE emergency services immediately.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Police', number: '999', icon: Shield },
              { label: 'Ambulance', number: '998', icon: Radio },
              { label: 'Fire', number: '997', icon: Flame },
            ].map((svc) => (
              <a
                key={svc.number}
                href={`tel:${svc.number}`}
                className="flex flex-col items-center justify-center gap-1.5 py-3 rounded-xl bg-danger/10 hover:bg-danger/10 text-danger transition-colors border border-danger/30"
              >
                <svc.icon className="w-5 h-5 text-danger" />
                <span className="text-xs font-semibold">{svc.label}</span>
                <span className="text-[11px] font-mono font-bold">{svc.number}</span>
              </a>
            ))}
          </div>
          <Button
            variant="secondary"
            fullWidth
            size="md"
            leftIcon={<Share2 className="w-4 h-4 text-info" />}
            onClick={() => {
              if (!navigator.geolocation) return showToast('This browser cannot share its location.', 'error');
              navigator.geolocation.getCurrentPosition(
                async ({ coords }) => {
                  const link = `https://maps.google.com/?q=${coords.latitude.toFixed(6)},${coords.longitude.toFixed(6)}`;
                  const text = `I need help — my location: ${link}`;
                  try {
                    if (navigator.share) await navigator.share({ title: 'My location', text });
                    else {
                      await navigator.clipboard.writeText(text);
                      showToast('Location link copied — paste it to your contact.', 'success');
                    }
                    setIsSosSheetOpen(false);
                  } catch (err) {
                    if ((err as Error).name !== 'AbortError') showToast('Could not share your location.', 'error');
                  }
                },
                () => showToast('Location permission denied.', 'error'),
                { enableHighAccuracy: true, timeout: 10_000 },
              );
            }}
          >
            Share my location with a contact
          </Button>
          {SUPPORT_PHONE && (
            <a
              href={`tel:${SUPPORT_PHONE}`}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-line text-sm font-semibold text-ink"
            >
              <Phone className="w-4 h-4 text-success" />
              Call TowNow support ({SUPPORT_PHONE})
            </a>
          )}
          <div className="flex items-start gap-2 p-3 rounded-xl bg-lime/20 border border-navy/30 text-[11px] text-navy">
            <AlertTriangle className="w-4 h-4 text-navy shrink-0" />
            <span>Turn on hazard lights and wait behind the safety barrier, away from traffic.</span>
          </div>
        </div>
      </BottomSheet>

      {/* Edit Profile Sheet */}
      <BottomSheet
        isOpen={isEditProfileOpen}
        onClose={() => setIsEditProfileOpen(false)}
        title="Edit Profile"
      >
        <form
          className="space-y-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void saveProfile();
          }}
        >
          <Input
            label="Full Name"
            id="profile-full-name"
            placeholder="e.g. Rashid Al-Maktoum"
            value={editName}
            maxLength={120}
            onChange={(e) => setEditName(e.target.value)}
          />
          <Input
            label="Email (optional)"
            id="profile-email"
            type="email"
            placeholder="you@example.ae"
            value={editEmail}
            maxLength={255}
            onChange={(e) => setEditEmail(e.target.value)}
          />
          {editError && <p className="text-xs text-danger font-medium">{editError}</p>}
          <Button type="submit" variant="primary" fullWidth size="lg" isLoading={savingProfile}>
            Save Profile
          </Button>
        </form>
      </BottomSheet>

      {/* Add Vehicle Sheet */}
      <BottomSheet
        isOpen={isAddVehicleOpen}
        onClose={() => {
          setIsAddVehicleOpen(false);
          setNewVehicleErrors({});
        }}
        title={editingVehicleId ? 'Edit Vehicle' : 'Add UAE Registered Vehicle'}
      >
        <form
          className="space-y-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void handleAddVehicle();
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            {(['car', 'motorbike'] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setNewVehicle({ ...newVehicle, category: cat })}
                className={`p-2.5 rounded-xl border text-xs font-medium flex items-center justify-center gap-2 transition-all ${
                  newVehicle.category === cat
                    ? 'bg-lime/30 border-navy text-navy font-semibold'
                    : 'bg-surface border-line text-ink/80 hover:border-line'
                }`}
              >
                {cat === 'car' ? <Car className="w-4 h-4" /> : <Bike className="w-4 h-4" />}
                <span>{cat === 'car' ? 'Car / SUV' : 'Motorbike'}</span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              label="Brand"
              id="new-vehicle-brand"
              placeholder="e.g. Toyota"
              value={newVehicle.brand}
              error={newVehicleErrors.brand}
              onChange={(e) => setNewVehicle({ ...newVehicle, brand: e.target.value })}
            />
            <Input
              label="Model"
              id="new-vehicle-model"
              placeholder="e.g. Land Cruiser"
              value={newVehicle.model}
              error={newVehicleErrors.model}
              onChange={(e) => setNewVehicle({ ...newVehicle, model: e.target.value })}
            />
            <Input
              label="Year"
              id="new-vehicle-year"
              inputMode="numeric"
              value={newVehicle.year}
              error={newVehicleErrors.year}
              onChange={(e) => setNewVehicle({ ...newVehicle, year: e.target.value })}
            />
            <Input
              label="Color"
              id="new-vehicle-color"
              value={newVehicle.color}
              onChange={(e) => setNewVehicle({ ...newVehicle, color: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Select
              label="Emirate"
              id="new-vehicle-emirate"
              value={newVehicle.plateEmirate}
              options={EMIRATES.map((em) => ({ value: em, label: em }))}
              onChange={(e) =>
                setNewVehicle({
                  ...newVehicle,
                  plateEmirate: e.target.value as Emirate,
                })
              }
            />
            <Input
              label="Code"
              id="new-vehicle-code"
              maxLength={3}
              value={newVehicle.plateCode}
              error={newVehicleErrors.plateCode}
              onChange={(e) => setNewVehicle({ ...newVehicle, plateCode: e.target.value })}
            />
            <Input
              label="Plate No."
              id="new-vehicle-plate"
              inputMode="numeric"
              maxLength={5}
              placeholder="12345"
              value={newVehicle.plateNumber}
              error={newVehicleErrors.plateNumber}
              onChange={(e) => setNewVehicle({ ...newVehicle, plateNumber: e.target.value })}
            />
          </div>
          {newVehicleErrors.form && (
            <p className="text-xs text-danger font-medium">{newVehicleErrors.form}</p>
          )}
          <Button type="submit" variant="primary" fullWidth size="lg" isLoading={savingVehicle}>
            {editingVehicleId ? 'Save Changes' : 'Save Vehicle'}
          </Button>
        </form>
      </BottomSheet>

      {/* Remove Vehicle Confirmation */}
      <ConfirmationDialog
        isOpen={vehicleToRemove !== null}
        onClose={() => setVehicleToRemove(null)}
        onConfirm={() => void confirmRemoveVehicle()}
        title="Remove this vehicle?"
        message={
          vehicleToRemove
            ? `${vehicleToRemove.brand} ${vehicleToRemove.model} (${vehicleToRemove.plateEmirate} ${vehicleToRemove.plateCode} ${vehicleToRemove.plateNumber}) will be removed from your account. Past bookings keep their records.`
            : ''
        }
        confirmLabel="Remove"
        cancelLabel="Keep"
        variant="danger"
      />

      {/* Cancel Booking Confirmation */}
      <ConfirmationDialog
        isOpen={isCancelOpen}
        onClose={() => {
          setIsCancelOpen(false);
          setCancelReason('');
        }}
        onConfirm={() => void confirmCancel()}
        title={cancelTarget ? `Cancel ${cancelTarget.bookingNumber}?` : 'Cancel this tow request?'}
        message={
          cancelTarget?.cancellationFeeMayApply
            ? 'Your driver is already on the way. A cancellation fee may apply.'
            : 'No driver has been assigned yet, so there is no cancellation fee.'
        }
        confirmLabel="Yes, Cancel"
        cancelLabel="Keep Booking"
        variant="danger"
      >
        <div className="w-full space-y-2 mb-5 text-left">
          <label className="block text-xs font-medium text-muted">Reason for cancelling</label>
          {cancelReasons.map((reason) => (
            <button
              key={reason}
              type="button"
              onClick={() => setCancelReason(reason)}
              className={`w-full p-2.5 rounded-xl border text-left text-xs font-medium transition-all ${
                cancelReason === reason
                  ? 'bg-lime/30 border-navy text-navy font-semibold'
                  : 'bg-surface border-line text-ink/80 hover:border-line'
              }`}
            >
              {reason}
            </button>
          ))}
        </div>
      </ConfirmationDialog>

      {/* Tax Invoice Modal */}
      <Modal
        isOpen={showInvoiceModal}
        onClose={() => setShowInvoiceModal(false)}
        title={invoice ? `${invoice.title} ${invoice.invoiceNumber}` : 'Booking Summary'}
        subtitle={
          invoice
            ? `${invoice.bookingNumber} · ${invoice.seller.trn ? `TRN ${invoice.seller.trn}` : 'TRN not registered'}`
            : `${invoiceBooking?.bookingNumber ?? ''} · receipt issued when the tow is completed`
        }
      >
        {invoice ? (
          <div className="space-y-3 text-xs">
            {invoice.notice && (
              <div className="p-2.5 rounded-xl bg-lime/20 border border-navy/30 text-navy">{invoice.notice}</div>
            )}
            <div className="p-3 rounded-xl bg-canvas/60 border border-line space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted">Issued</span>
                <span className="font-mono text-ink">{new Date(invoice.issuedAt).toLocaleString('en-GB')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Customer</span>
                <span className="text-ink">{invoice.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Payment</span>
                <span className="text-ink">
                  {paymentLabels[invoice.paymentMethod]}
                  {invoice.paymentStatus ? ` · ${PAYMENT_STATUS_LABELS[invoice.paymentStatus]}` : ''}
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-ink/80">
                <span>Towing service (excl. VAT)</span>
                <span className="font-mono tabular-nums">{formatAed(invoice.subtotalFils)}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>UAE VAT ({invoice.vatRateBps / 100}%)</span>
                <span className="font-mono tabular-nums">{formatAed(invoice.vatFils)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-ink pt-2 border-t border-line">
                <span>Total payable</span>
                <span className="text-navy font-mono tabular-nums">{formatAed(invoice.totalFils)}</span>
              </div>
            </div>
            <Button variant="primary" fullWidth size="md" leftIcon={<Download className="w-4 h-4" />} onClick={downloadInvoice}>
              Download {invoice.title}
            </Button>
          </div>
        ) : !invoiceBooking ? (
          <p className="text-xs text-muted">The receipt is issued when the tow is completed.</p>
        ) : (
        <div className="space-y-3 text-xs">
          <div className="p-3 rounded-xl bg-canvas/60 border border-line space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted">Date</span>
              <span className="font-mono text-ink">{invoiceBooking.createdAt}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Customer</span>
              <span className="text-ink">{invoiceBooking.customer.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Vehicle</span>
              <span className="text-ink">
                {invoiceBooking.vehicle.brand} {invoiceBooking.vehicle.model}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Payment</span>
              <span className="text-ink">{paymentLabels[invoiceBooking.paymentMethod]}</span>
            </div>
          </div>
          <div className="space-y-1.5">
            {[
              ['Base Hookup Fare', invoiceBooking.fareBreakdown.baseFare],
              ['Distance Charge', invoiceBooking.fareBreakdown.distanceCharge],
              ['Tow Type Charge', invoiceBooking.fareBreakdown.towTypeCharge],
            ].map(([label, amount]) => (
              <div key={label as string} className="flex justify-between text-ink/80">
                <span>{label}</span>
                <span className="font-mono tabular-nums">AED {(amount as number).toFixed(2)}</span>
              </div>
            ))}
            <div className="flex justify-between text-muted pt-2 border-t border-line">
              <span>Subtotal</span>
              <span className="font-mono tabular-nums">
                AED {invoiceBooking.fareBreakdown.subtotal.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-muted">
              <span>UAE Federal VAT (5%)</span>
              <span className="font-mono tabular-nums">
                AED {invoiceBooking.fareBreakdown.vat.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-sm font-bold text-ink pt-2 border-t border-line">
              <span>Total</span>
              <span className="text-navy font-mono tabular-nums">
                AED {invoiceBooking.fareBreakdown.total.toFixed(2)}
              </span>
            </div>
          </div>
          <Button
            variant="primary"
            fullWidth
            size="md"
            leftIcon={<Download className="w-4 h-4" />}
            onClick={downloadInvoice}
          >
            Download Summary
          </Button>
        </div>
        )}
      </Modal>

      {/* Report a problem (dispute) */}
      <Modal
        isOpen={!!disputeTarget}
        onClose={() => setDisputeTarget(null)}
        title="Report a problem"
        subtitle={disputeTarget ? `${disputeTarget.bookingNumber} · TowNow support reviews every report` : ''}
      >
        <form
          className="space-y-3 text-xs"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!disputeTarget) return;
            const problem = disputeReasonError(disputeReason);
            if (problem) return showToast(problem, 'error');
            setDisputeBusy(true);
            try {
              await raiseDispute(auth.client, disputeTarget.id, disputeReason.trim());
              setDisputeTarget(null);
              showToast('Sent to TowNow. Follow it in My disputes.', 'success');
            } catch (err) {
              showToast(err instanceof ApiError ? err.message : 'Could not send your report. Check your connection.', 'error');
            } finally {
              setDisputeBusy(false);
            }
          }}
        >
          <label className="block font-medium text-muted" htmlFor="dispute-reason">What went wrong?</label>
          <textarea
            id="dispute-reason"
            value={disputeReason}
            onChange={(e) => setDisputeReason(e.target.value)}
            placeholder="Describe the problem (at least 10 characters)"
            maxLength={1000}
            className="w-full bg-surface border border-line rounded-xl p-3 text-xs text-ink placeholder-muted focus:outline-none focus:border-navy min-h-[100px]"
          />
          <Button type="submit" variant="primary" fullWidth size="md" isLoading={disputeBusy}>
            Send to TowNow
          </Button>
        </form>
      </Modal>
    </>
  );
};
