import 'dart:async';

import 'package:flutter/material.dart';
import 'package:townow_core/townow_core.dart';

import '../location_reporter.dart';
import '../widgets.dart';
import 'job_screen.dart';
import 'onboarding_screen.dart';

/// Home tab: verification state, online switch, today's real stats, incoming offer, job.
class WorkScreen extends StatefulWidget {
  const WorkScreen({super.key});

  @override
  State<WorkScreen> createState() => _WorkScreenState();
}

class _WorkScreenState extends State<WorkScreen> {
  DriverProfile? _profile;
  DriverJob? _job;
  DriverJob? _offer;
  DriverLedger? _ledger;
  String? _error;
  bool _busy = false;
  late final LocationReporter _reporter;
  final _unsubscribe = <void Function()>[];
  final _offerTotals = <String, int>{}; // offerId → seconds left when first seen
  Timer? _poll;
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    _reporter = LocationReporter(context.api);
    final rt = context.realtime;
    _unsubscribe.addAll([
      rt.on(RealtimeEvents.offerNew, (data) {
        try {
          setState(() => _offer = DriverJob.fromJson(data));
        } catch (_) {
          _refresh();
        }
      }),
      rt.on(RealtimeEvents.offerClosed, (data) {
        if (data['offerId'] == _offer?.offerId) setState(() => _offer = null);
      }),
      rt.on(RealtimeEvents.jobCancelled, (_) {
        context.toast('The customer cancelled this job.', error: true);
        _refresh();
      }),
      rt.on(RealtimeEvents.kycUpdated, (_) => _refresh()),
    ]);
    // Sockets can miss events (background, network change): poll as a safety net.
    _poll = Timer.periodic(const Duration(seconds: 10), (_) {
      if (_isOnline && _job == null) _refresh();
    });
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_offer != null && mounted) setState(() {});
    });
    _refresh();
  }

  @override
  void dispose() {
    for (final u in _unsubscribe) {
      u();
    }
    _poll?.cancel();
    _tick?.cancel();
    _reporter.stop();
    super.dispose();
  }

  bool get _isOnline => _profile != null && _profile!.availability != 'offline';

  Future<void> _refresh() async {
    final api = context.api;
    try {
      final results = await Future.wait([
        api.driverProfile(),
        api.currentJob(),
        api.currentOffer(),
      ]);
      if (!mounted) return;
      setState(() {
        _profile = results[0] as DriverProfile;
        _job = results[1] as DriverJob?;
        _offer = results[2] as DriverJob?;
        _error = null;
      });
      // Keep reporting GPS whenever the driver is online or on a job (e.g. after an app restart).
      if ((_isOnline || _job != null) && !_reporter.running) _startReporting();
      // Set offline elsewhere (e.g. by the server after GPS went stale): stop sharing.
      if (!_isOnline && _job == null && _reporter.running) _reporter.stop();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
    // Stats are optional: a failure here never blocks work.
    try {
      final ledger = await api.earnings();
      if (mounted) setState(() => _ledger = ledger);
    } on ApiException {
      // keep the last value
    }
  }

  /// GPS problems (permission revoked, no fix yet) never break the screen; the driver
  /// sees them when going online, which needs a position.
  Future<void> _startReporting() async {
    try {
      if (await LocationReporter.ensurePermission() == null) await _reporter.start();
    } catch (e) {
      debugPrint('Location reporting not started: $e');
    }
  }

  Future<void> _setOnline(bool online) async {
    setState(() => _busy = true);
    try {
      if (online) {
        final denied = await LocationReporter.ensurePermission();
        if (denied != null) {
          if (mounted) context.toast(denied, error: true);
          return;
        }
        await _reporter.start(); // the API needs a fresh position for matching
      }
      if (!mounted) return;
      final ok = await context.guard(() => context.api.setAvailability(online));
      if (!online) _reporter.stop();
      if (ok != null && online) await LocationReporter.requestBatteryExemption();
      if (ok != null && mounted) {
        context.toast(
          online ? 'You\'re online — requests will appear here' : 'You\'re offline',
          success: true,
        );
      }
      await _refresh();
    } catch (_) {
      if (mounted) context.toast('Couldn\'t get your GPS position. Try again.', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _answer(bool accept) async {
    final offer = _offer;
    if (offer == null || _busy) return;
    setState(() => _busy = true);
    final api = context.api;
    final ok = await context.guard(() async {
      if (accept) {
        final job = await api.acceptOffer(offer.offerId!);
        setState(() => _job = job);
      } else {
        await api.declineOffer(offer.offerId!);
      }
      return true;
    });
    if (mounted) {
      setState(() {
        _offer = null;
        _busy = false;
      });
      if (ok == true) context.toast(accept ? 'Job accepted' : 'Request declined', success: accept);
    }
    _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final profile = _profile;
    if (profile == null) {
      return SafeArea(
        child: _error == null
            ? const SkeletonList(count: 3)
            : Center(
                child: ErrorState(message: _error!, onRetry: _refresh),
              ),
      );
    }
    final job = _job;
    if (job != null) {
      return SafeArea(child: JobScreen(job: job, onChanged: _refresh));
    }

    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          _header(profile),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (!profile.approved) _kycCard(profile),
                if (_offer != null) _offerCard(_offer!),
                if (profile.approved && _offer == null) _waitingCard(),
                const SectionTitle('Today'),
                _statsRow(profile),
                if (profile.towTrucks.isNotEmpty) ...[
                  const SectionTitle('Your truck'),
                  TnCard(
                    child: InfoRow(
                      icon:
                          towIcons[profile.towTrucks.first.towType] ?? Icons.local_shipping_rounded,
                      iconBg: TnColors.lime,
                      title: profile.towTrucks.first.model,
                      subtitle:
                          '${towTypeLabels[profile.towTrucks.first.towType] ?? profile.towTrucks.first.towType} · ${profile.towTrucks.first.plate}',
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _header(DriverProfile p) {
    final first = p.fullName?.split(' ').first;
    return TnHeroHeader(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const TnWordmark(onDark: true, size: 22),
              const Spacer(),
              StatusChip(
                p.kycStatus == 'approved' ? (_isOnline ? 'online' : 'offline') : p.kycStatus,
              ),
            ],
          ),
          const SizedBox(height: 20),
          Text(
            first == null ? 'Hello' : 'Hello, $first',
            style: const TextStyle(
              color: TnColors.white,
              fontSize: 26,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 16),
          if (p.approved)
            AnimatedContainer(
              duration: const Duration(milliseconds: 300),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              decoration: BoxDecoration(
                color: _isOnline ? TnColors.lime : TnColors.deepNavy,
                borderRadius: BorderRadius.circular(TnRadius.lg),
              ),
              child: Row(
                children: [
                  Icon(
                    _isOnline ? Icons.wifi_tethering_rounded : Icons.wifi_tethering_off_rounded,
                    color: _isOnline ? TnColors.navy : Colors.white70,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _isOnline ? 'You are online' : 'You are offline',
                          style: TextStyle(
                            fontWeight: FontWeight.w800,
                            fontSize: 16,
                            color: _isOnline ? TnColors.navy : TnColors.white,
                          ),
                        ),
                        Text(
                          _isOnline
                              ? 'Sharing your location with dispatch'
                              : 'Go online to receive tow requests',
                          style: TextStyle(
                            color: _isOnline ? TnColors.deepNavy : Colors.white60,
                            fontSize: 13,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Switch(
                    key: const Key('online'),
                    value: _isOnline,
                    onChanged: _busy ? null : _setOnline,
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _statsRow(DriverProfile p) {
    final now = DateTime.now();
    final today = (_ledger?.entries ?? const <LedgerEntry>[]).where(
      (e) =>
          e.type == 'trip_earning' &&
          e.createdAt.year == now.year &&
          e.createdAt.month == now.month &&
          e.createdAt.day == now.day,
    );
    final earned = today.fold<int>(0, (a, e) => a + e.amountFils);
    Widget stat(String label, Widget value) => Expanded(
      child: TnCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: const TextStyle(color: TnColors.muted, fontSize: 12)),
            const SizedBox(height: 6),
            value,
          ],
        ),
      ),
    );
    return Row(
      children: [
        stat(
          'Earned today',
          _ledger == null ? const Skeleton(width: 70, height: 22) : MoneyText(earned, size: 20),
        ),
        const SizedBox(width: 10),
        stat(
          'Jobs today',
          Text(
            _ledger == null ? '—' : '${today.length}',
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
          ),
        ),
        const SizedBox(width: 10),
        stat(
          'Rating',
          Text(
            p.rating == null ? 'New' : '${p.rating!.toStringAsFixed(1)}★',
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
          ),
        ),
      ],
    );
  }

  Widget _waitingCard() {
    if (!_isOnline) {
      return const TnCard(
        child: InfoRow(
          icon: Icons.power_settings_new_rounded,
          title: 'You\'re offline',
          subtitle: 'Turn on the switch above to start receiving nearby tow requests.',
        ),
      );
    }
    return const TnCard(
      child: Row(
        children: [
          PulseRings(size: 56, child: Icon(Icons.radar_rounded, color: TnColors.navy)),
          SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Waiting for tow requests',
                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
                ),
                Text(
                  'Keep the app open. New requests appear here.',
                  style: TextStyle(color: TnColors.muted, fontSize: 13),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _kycCard(DriverProfile p) {
    final rejected = p.kycStatus == 'rejected';
    return TnCard(
      borderColor: rejected ? TnColors.error : TnColors.warning,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(
                rejected ? Icons.error_rounded : Icons.hourglass_top_rounded,
                color: rejected ? TnColors.error : TnColors.warning,
              ),
              const SizedBox(width: 10),
              Text(
                rejected ? 'Verification rejected' : 'Verification pending',
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            rejected
                ? (p.kycRejectionReason ?? 'Please check your documents and upload them again.')
                : 'Add your tow truck and upload your four documents. TowNow reviews them before you can go online.',
            style: const TextStyle(color: TnColors.muted),
          ),
          const SizedBox(height: 14),
          TnButton(
            label: 'Complete verification',
            icon: Icons.verified_user_rounded,
            onPressed: () async {
              await Navigator.of(context)
                  .push(MaterialPageRoute<void>(builder: (_) => const OnboardingScreen()));
              _refresh();
            },
          ),
        ],
      ),
    );
  }

  Widget _offerCard(DriverJob o) {
    final left = o.expiresAt == null ? 0 : o.expiresAt!.difference(DateTime.now()).inSeconds;
    final total = _offerTotals.putIfAbsent(o.offerId ?? '', () => left.clamp(1, 999));
    return TnCard(
      color: TnColors.navy,
      borderColor: TnColors.navy,
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'New tow request',
                      style: TextStyle(
                        color: TnColors.white,
                        fontSize: 20,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    Text(
                      '${towTypeLabels[o.towType] ?? o.towType} · ${o.issue} · ${o.vehicleTitle}',
                      style: const TextStyle(color: Colors.white70),
                    ),
                  ],
                ),
              ),
              CountdownRing(secondsLeft: left, totalSeconds: total),
            ],
          ),
          const SizedBox(height: 16),
          RouteBlock(pickup: o.pickup.address, dropoff: o.dropoff.address, onDark: true),
          const SizedBox(height: 14),
          Row(
            children: [
              if (o.distanceToPickupMeters != null)
                _pill(Icons.near_me_rounded, '${formatKm(o.distanceToPickupMeters!)} away'),
              const SizedBox(width: 8),
              _pill(Icons.route_rounded, 'Trip ${formatKm(o.tripDistanceMeters)}'),
            ],
          ),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: TnColors.deepNavy,
              borderRadius: BorderRadius.circular(TnRadius.md),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Your payout',
                        style: TextStyle(color: Colors.white60, fontSize: 12),
                      ),
                      MoneyText(o.driverPayoutFils, size: 24, color: TnColors.lime),
                    ],
                  ),
                ),
                Text(
                  'Customer pays ${formatAed(o.fareTotalFils)}\n${o.paymentMethod == 'cash' ? 'in cash' : 'by card'}',
                  textAlign: TextAlign.right,
                  style: const TextStyle(color: Colors.white70, fontSize: 12),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: TnColors.white,
                    side: const BorderSide(color: TnColors.deepNavy, width: 1.4),
                  ),
                  onPressed: _busy ? null : () => _answer(false),
                  child: const Text('Decline'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                flex: 2,
                child: FilledButton(
                  key: const Key('accept'),
                  onPressed: _busy || left <= 0 ? null : () => _answer(true),
                  child: Text(left <= 0 ? 'Expired' : 'Accept'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _pill(IconData icon, String text) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(color: TnColors.deepNavy, borderRadius: BorderRadius.circular(99)),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: TnColors.lime),
        const SizedBox(width: 6),
        Text(
          text,
          style: const TextStyle(color: TnColors.white, fontSize: 12, fontWeight: FontWeight.w700),
        ),
      ],
    ),
  );
}
