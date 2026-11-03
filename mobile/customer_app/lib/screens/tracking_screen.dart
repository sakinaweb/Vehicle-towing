import 'dart:async';

import 'package:flutter/material.dart';
import 'package:townow_core/townow_core.dart';

import '../payments/card_payment.dart';
import '../widgets.dart';
import 'completed_screen.dart';

const _cardStatus = {
  'pending': 'awaiting payment',
  'failed': 'payment failed',
  'authorized': 'held, charged after delivery',
  'captured': 'paid',
  'refunded': 'refunded',
  'cancelled': 'hold released',
};

/// A card booking that still needs the customer to pay before a driver is matched.
bool needsCardPayment(Booking b) =>
    b.paymentMethod != 'cash' &&
    b.status == 'requested' &&
    (b.payment == null || b.payment!.status == 'pending' || b.payment!.status == 'failed');

/// Live tow: status from the server (socket push + 10 s poll as a safety net), the driver's
/// real position and ETA when available, and cancellation while it is still allowed.
class TrackingScreen extends StatefulWidget {
  const TrackingScreen({super.key, required this.bookingId, this.payNow = false});

  final String bookingId;

  /// Open the card form as soon as the booking loads (right after booking with card).
  final bool payNow;

  @override
  State<TrackingScreen> createState() => _TrackingScreenState();
}

class _TrackingScreenState extends State<TrackingScreen> {
  Booking? _booking;
  DriverLocationView? _location;
  String? _error;
  Timer? _poll;
  final _unsubscribe = <void Function()>[];
  bool _paying = false;
  late bool _autoPay = widget.payNow;

  @override
  void initState() {
    super.initState();
    final rt = context.realtime;
    _unsubscribe.addAll([
      rt.on(RealtimeEvents.bookingUpdated, (d) {
        if (d['bookingId'] == widget.bookingId) _refresh();
      }),
      rt.on(RealtimeEvents.tripLocation, (d) {
        if (d['bookingId'] == widget.bookingId) _refreshLocation();
      }),
      rt.on(RealtimeEvents.paymentUpdated, (d) {
        if (d['bookingId'] == widget.bookingId) _refresh();
      }),
    ]);
    _poll = Timer.periodic(const Duration(seconds: 10), (_) => _refresh());
    _refresh();
  }

  @override
  void dispose() {
    _poll?.cancel();
    for (final u in _unsubscribe) {
      u();
    }
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      final b = await context.api.booking(widget.bookingId);
      if (!mounted) return;
      setState(() {
        _booking = b;
        _error = null;
      });
      if (b.status == 'completed') {
        _poll?.cancel();
        Navigator.of(context).pushReplacement(
          MaterialPageRoute<void>(builder: (_) => CompletedScreen(bookingId: b.id)),
        );
        return;
      }
      if (b.driver != null && !b.isFinal) _refreshLocation();
      if (_autoPay) {
        _autoPay = false;
        if (needsCardPayment(b)) _pay();
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  /// Card form → server status. Closing the form or a decline leaves "Pay now" for a retry.
  Future<void> _pay() async {
    if (_paying) return;
    setState(() => _paying = true);
    await payByCard(context, widget.bookingId);
    if (!mounted) return;
    setState(() => _paying = false);
    await _refresh();
  }

  Future<void> _refreshLocation() async {
    try {
      final loc = await context.api.driverLocation(widget.bookingId);
      if (mounted) setState(() => _location = loc);
    } on ApiException {
      // No driver on the job right now (e.g. just cancelled): keep the last view.
    }
  }

  Future<void> _cancel() async {
    final reason = TextEditingController();
    final api = context.api;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancel this tow?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (_booking?.driver != null)
              const Padding(
                padding: EdgeInsets.only(bottom: 12),
                child: Text(
                  'A driver is already on the way to you.',
                  style: TextStyle(color: TnColors.warning, fontWeight: FontWeight.w600),
                ),
              ),
            TextField(
              controller: reason,
              decoration: const InputDecoration(labelText: 'Reason', hintText: 'e.g. Car started'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep tow')),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: TnColors.error,
              foregroundColor: TnColors.white,
              minimumSize: const Size(0, 44),
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Cancel tow'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final text = reason.text.trim().length >= 3 ? reason.text.trim() : 'Cancelled in the app';
    final b = await context.guard(() => api.cancelBooking(widget.bookingId, text));
    if (b != null && mounted) setState(() => _booking = b);
  }

  @override
  Widget build(BuildContext context) {
    final b = _booking;
    return Scaffold(
      appBar: AppBar(
        title: Text(b?.bookingNumber ?? 'Your tow'),
        actions: [
          if (b?.driver != null)
            IconButton(
              key: const Key('open-chat'),
              tooltip: 'Chat with your driver',
              icon: const Icon(Icons.chat_bubble_outline_rounded),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => ChatScreen(
                    bookingId: widget.bookingId,
                    title: 'Chat with ${b!.driver!.firstName}',
                    canSend: !b.isFinal,
                  ),
                ),
              ),
            ),
          IconButton(
            key: const Key('open-sos'),
            tooltip: 'Emergency / SOS',
            icon: const Icon(Icons.sos_rounded, color: TnColors.error),
            onPressed: () => showSosSheet(context, bookingId: widget.bookingId),
          ),
        ],
      ),
      body: b == null
          ? (_error == null
                ? const SkeletonList(count: 3)
                : ErrorState(message: _error!, onRetry: _refresh))
          : RefreshIndicator(
              onRefresh: _refresh,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 28),
                children: [
                  _statusHeader(b),
                  if (needsCardPayment(b)) ...[const SizedBox(height: 14), _payCard(b)],
                  if (b.driver != null && !b.isFinal) ...[
                    const SizedBox(height: 14),
                    _driverCard(b.driver!),
                  ],
                  const SizedBox(height: 14),
                  MapView(
                    height: 240,
                    markers: [
                      MapMarker(
                        'pickup',
                        b.pickup.lat,
                        b.pickup.lng,
                        'Pickup',
                        icon: Icons.trip_origin,
                        note: b.pickup.address,
                      ),
                      if (_location?.location != null && !b.isFinal)
                        MapMarker(
                          'driver',
                          _location!.location!.lat,
                          _location!.location!.lng,
                          'Tow truck',
                          hue: 45,
                          icon: Icons.local_shipping_rounded,
                        ),
                      MapMarker(
                        'dropoff',
                        b.dropoff.lat,
                        b.dropoff.lng,
                        'Destination',
                        hue: 120,
                        icon: Icons.flag_rounded,
                        note: b.dropoff.address,
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  TnCard(
                    child: Column(
                      children: [
                        Row(
                          children: [
                            const Expanded(
                              child: Text('Fare', style: TextStyle(color: TnColors.muted)),
                            ),
                            MoneyText(b.fare.totalFils, size: 22),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Row(
                          children: [
                            const Icon(Icons.payments_rounded, size: 16, color: TnColors.muted),
                            const SizedBox(width: 6),
                            Expanded(
                              child: Text(
                                b.paymentMethod == 'cash'
                                    ? 'Cash to the driver · incl. VAT ${formatAed(b.fare.vatFils)}'
                                    : 'Card · ${_cardStatus[b.payment?.status ?? 'pending'] ?? b.payment!.status} · incl. VAT ${formatAed(b.fare.vatFils)}',
                                key: const Key('payment-line'),
                                style: const TextStyle(color: TnColors.muted, fontSize: 13),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  if (b.status != 'cancelled') ...[
                    const SectionTitle('Progress'),
                    TnCard(
                      child: BookingTimeline(
                        status: b.status,
                        times: {
                          for (final h in b.history) h.toStatus: h.at,
                          if (b.history.any((h) => h.toStatus == 'vehicle_loaded'))
                            'in_transit': b.history
                                .firstWhere((h) => h.toStatus == 'vehicle_loaded')
                                .at,
                        },
                      ),
                    ),
                  ],
                  if (b.canCancel) ...[
                    const SizedBox(height: 20),
                    OutlinedButton.icon(
                      key: const Key('cancel'),
                      style: OutlinedButton.styleFrom(foregroundColor: TnColors.error),
                      icon: const Icon(Icons.close_rounded),
                      label: const Text('Cancel tow'),
                      onPressed: _cancel,
                    ),
                  ],
                ],
              ),
            ),
    );
  }

  Widget _statusHeader(Booking b) {
    final searching = b.status == 'searching' || b.status == 'requested';
    if (b.status == 'cancelled') {
      return TnCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const StatusChip('cancelled'),
            const SizedBox(height: 10),
            Text(
              statusLabel(b.status),
              key: const Key('status'),
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            if (b.cancellationReason != null)
              Text(b.cancellationReason!, style: const TextStyle(color: TnColors.muted)),
          ],
        ),
      );
    }
    return TnCard(
      color: TnColors.navy,
      borderColor: TnColors.navy,
      padding: const EdgeInsets.all(20),
      child: Row(
        children: [
          PulseRings(
            size: 64,
            color: searching ? TnColors.lime : TnColors.lime.withValues(alpha: 0.6),
            child: Icon(
              searching ? Icons.radar_rounded : Icons.local_shipping_rounded,
              color: TnColors.navy,
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  statusLabel(b.status),
                  key: const Key('status'),
                  style: const TextStyle(
                    color: TnColors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  needsCardPayment(b)
                      ? 'Complete the card payment and we start finding a tow truck.'
                      : searching
                      ? 'Contacting verified tow trucks near you. This can take a few minutes.'
                      : _location?.etaLabel ?? 'Updating…',
                  style: const TextStyle(color: Colors.white70),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _payCard(Booking b) {
    final failed = b.payment?.status == 'failed';
    return TnCard(
      key: const Key('pay-card-box'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            failed ? 'Card payment failed' : 'Complete your card payment',
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
          ),
          const SizedBox(height: 4),
          Text(
            failed
                ? (b.payment!.failureReason ?? 'Try again, or use another card.')
                : 'Your card is held now and charged only after delivery.',
            style: TextStyle(color: failed ? TnColors.error : TnColors.muted),
          ),
          const SizedBox(height: 4),
          const Text(
            'Unpaid card bookings are cancelled automatically after 30 minutes.',
            style: TextStyle(color: TnColors.muted, fontSize: 12),
          ),
          const SizedBox(height: 12),
          TnButton(
            key: const Key('pay-now'),
            label: failed
                ? 'Try again · ${formatAed(b.fare.totalFils)}'
                : 'Pay now · ${formatAed(b.fare.totalFils)}',
            icon: Icons.credit_card_rounded,
            onPressed: _paying ? null : _pay,
          ),
        ],
      ),
    );
  }

  Widget _driverCard(AssignedDriver d) {
    final loc = _location?.location;
    return TnCard(
      child: Column(
        children: [
          Row(
            children: [
              InitialsAvatar(d.firstName, size: 52),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      d.firstName,
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18),
                    ),
                    Row(
                      children: [
                        const Icon(Icons.star_rounded, size: 16, color: TnColors.warning),
                        const SizedBox(width: 2),
                        Text(
                          d.rating == null ? 'New' : d.rating!.toStringAsFixed(1),
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                        Text(
                          ' · ${d.totalTrips} tow${d.totalTrips == 1 ? '' : 's'}',
                          style: const TextStyle(color: TnColors.muted),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              if (_location != null)
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    StatusChip('driver_arriving', label: _location!.etaLabel),
                    if (loc != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        loc.stale ? 'Location delayed' : 'Updated ${loc.ageSeconds}s ago',
                        style: TextStyle(
                          fontSize: 12,
                          color: loc.stale ? TnColors.warning : TnColors.muted,
                        ),
                      ),
                    ],
                  ],
                ),
            ],
          ),
          const Divider(height: 24),
          Row(
            children: [
              const Icon(Icons.local_shipping_rounded, color: TnColors.navy),
              const SizedBox(width: 10),
              Expanded(
                child: Text(d.truckModel, style: const TextStyle(fontWeight: FontWeight.w600)),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: TnColors.navy, width: 1.2),
                ),
                child: Text(
                  d.truckPlate,
                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
