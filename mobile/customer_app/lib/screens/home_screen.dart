import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:townow_core/townow_core.dart';

import '../widgets.dart';
import 'request_screen.dart';
import 'tracking_screen.dart';

/// Greeting, pickup entry, real nearby availability, services, active tows, help.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, this.onOpenAccount});

  final VoidCallback? onOpenAccount;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

enum _NearbyState { loading, noPermission, unavailable, ready }

class _HomeScreenState extends State<HomeScreen> {
  List<Booking>? _active;
  String? _error;
  NearbyAvailability? _nearby;
  _NearbyState _nearbyState = _NearbyState.loading;
  // Booking a tow replaces the request screen with tracking, so returning from it never
  // reaches _open's reload: status changes (cancel, driver assigned…) refresh the list here.
  late final void Function() _unsubscribe;

  @override
  void initState() {
    super.initState();
    _unsubscribe = context.realtime.on(RealtimeEvents.bookingUpdated, (_) => _load());
    _load();
    _loadNearby(prompt: false);
  }

  @override
  void dispose() {
    _unsubscribe();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final list = await context.api.bookings(status: 'active');
      if (!mounted) return;
      setState(() {
        _active = list;
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  /// Uses the phone's real position; never prompts on its own unless asked.
  Future<void> _loadNearby({required bool prompt}) async {
    final api = context.api;
    setState(() => _nearbyState = _NearbyState.loading);
    try {
      var perm = await Geolocator.checkPermission();
      if (prompt && perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
        if (mounted) setState(() => _nearbyState = _NearbyState.noPermission);
        return;
      }
      final pos =
          await Geolocator.getLastKnownPosition() ??
          await Geolocator.getCurrentPosition().timeout(const Duration(seconds: 10));
      final nearby = await api.nearby(pos.latitude, pos.longitude);
      if (mounted) {
        setState(() {
          _nearby = nearby;
          _nearbyState = _NearbyState.ready;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _nearbyState = _NearbyState.unavailable);
    }
  }

  Future<void> _open(Widget screen) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
    _load();
    _loadNearby(prompt: false);
  }

  String get _greeting {
    final h = DateTime.now().hour;
    final part = h < 12 ? 'Good morning' : (h < 17 ? 'Good afternoon' : 'Good evening');
    final name = context.api.session?.user.fullName?.split(' ').first;
    return name == null || name.isEmpty ? part : '$part, $name';
  }

  @override
  Widget build(BuildContext context) {
    final user = context.api.session?.user;
    return RefreshIndicator(
      onRefresh: () async {
        await _load();
        await _loadNearby(prompt: false);
      },
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          TnHeroHeader(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const TnWordmark(onDark: true, size: 22),
                    const Spacer(),
                    IconButton(
                      tooltip: 'Notifications',
                      onPressed: () => _open(const InboxScreen()),
                      icon: const Icon(Icons.notifications_none_rounded, color: TnColors.white),
                    ),
                    GestureDetector(
                      onTap: widget.onOpenAccount,
                      child: InitialsAvatar(user?.fullName ?? 'TowNow', size: 38, dark: false),
                    ),
                  ],
                ),
                const SizedBox(height: 22),
                Text(_greeting, style: const TextStyle(color: Colors.white70, fontSize: 15)),
                const SizedBox(height: 4),
                const Text(
                  'Need a tow?',
                  style: TextStyle(
                    color: TnColors.white,
                    fontSize: 30,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -0.6,
                  ),
                ),
                const SizedBox(height: 18),
                Material(
                  color: TnColors.white,
                  borderRadius: BorderRadius.circular(TnRadius.md),
                  child: InkWell(
                    key: const Key('pickup-entry'),
                    borderRadius: BorderRadius.circular(TnRadius.md),
                    onTap: () => _open(const RequestScreen()),
                    child: const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                      child: Row(
                        children: [
                          Icon(Icons.my_location_rounded, color: TnColors.navy),
                          SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              'Where is your vehicle?',
                              style: TextStyle(
                                color: TnColors.muted,
                                fontSize: 16,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          Icon(Icons.arrow_forward_rounded, color: TnColors.navy),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_error != null) ErrorState(message: _error!, onRetry: _load),
                for (final b in _active ?? const <Booking>[]) ...[
                  _ActiveTowCard(
                    booking: b,
                    onTap: () => _open(TrackingScreen(bookingId: b.id)),
                  ),
                  const SizedBox(height: 12),
                ],
                _nearbyCard(),
                const SectionTitle('Services'),
                for (final s in towServices) ...[
                  TnCard(
                    onTap: () => _open(RequestScreen(initialTowType: s.towType)),
                    child: InfoRow(
                      icon: s.icon,
                      iconBg: TnColors.lime,
                      title: s.title,
                      subtitle: s.subtitle,
                      trailing: _availabilityBadge(s.towType),
                    ),
                  ),
                  const SizedBox(height: 10),
                ],
                const SizedBox(height: 8),
                TnButton(
                  key: const Key('request-tow'),
                  label: 'Request towing',
                  icon: Icons.add_road_rounded,
                  onPressed: () => _open(const RequestScreen()),
                ),
                const SectionTitle('Help'),
                TnCard(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                  child: Column(
                    children: [
                      if (TowNowConfig.supportPhone.isNotEmpty) ...[
                        InfoRow(
                          icon: Icons.headset_mic_rounded,
                          title: 'TowNow support',
                          subtitle: TowNowConfig.supportPhone,
                          onTap: () => callNumber(TowNowConfig.supportPhone),
                        ),
                        const Divider(),
                      ],
                      InfoRow(
                        icon: Icons.emergency_rounded,
                        iconColor: TnColors.error,
                        title: 'Emergency 999',
                        subtitle: 'Accident with injuries or danger on the road',
                        onTap: () => callNumber('999'),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget? _availabilityBadge(String towType) {
    final n = _nearby?.byTowType[towType];
    if (n == null) return const Icon(Icons.chevron_right_rounded, color: TnColors.muted);
    return StatusChip(
      n.available > 0 ? 'online' : 'offline',
      label: n.available > 0 ? '${n.available} nearby' : 'None nearby',
    );
  }

  Widget _nearbyCard() {
    final (IconData icon, String title, String subtitle, Widget? action) = switch (_nearbyState) {
      _NearbyState.loading => (Icons.radar_rounded, 'Checking for tow trucks near you…', '', null),
      _NearbyState.noPermission => (
        Icons.location_off_rounded,
        'See tow trucks near you',
        'Allow location access to check availability.',
        TextButton(onPressed: () => _loadNearby(prompt: true), child: const Text('Allow')),
      ),
      _NearbyState.unavailable => (
        Icons.location_searching_rounded,
        'Availability unavailable',
        'Couldn\'t get your location or reach TowNow.',
        TextButton(onPressed: () => _loadNearby(prompt: true), child: const Text('Retry')),
      ),
      _NearbyState.ready => _readyNearby(),
    };
    return TnCard(
      child: Row(
        children: [
          _nearbyState == _NearbyState.ready && (_nearby?.total ?? 0) > 0
              ? const PulseRings(
                  size: 44,
                  child: Icon(Icons.local_shipping_rounded, color: TnColors.navy, size: 20),
                )
              : Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: TnColors.bg,
                    borderRadius: BorderRadius.circular(TnRadius.sm),
                  ),
                  child: Icon(icon, color: TnColors.navy),
                ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
                if (subtitle.isNotEmpty)
                  Text(subtitle, style: const TextStyle(color: TnColors.muted, fontSize: 13)),
              ],
            ),
          ),
          ?action,
        ],
      ),
    );
  }

  (IconData, String, String, Widget?) _readyNearby() {
    final n = _nearby!;
    if (n.total == 0) {
      return (
        Icons.local_shipping_outlined,
        'No tow trucks online near you',
        'You can still book — we keep searching for a few minutes.',
        null,
      );
    }
    final nearest = n.byTowType.values
        .map((v) => v.nearestMeters)
        .whereType<int>()
        .fold<int?>(null, (a, b) => a == null || b < a ? b : a);
    return (
      Icons.local_shipping_rounded,
      '${n.total} tow truck${n.total == 1 ? '' : 's'} available near you',
      nearest == null ? '' : 'Nearest within about ${formatKm(nearest)}',
      null,
    );
  }
}

class _ActiveTowCard extends StatelessWidget {
  const _ActiveTowCard({required this.booking, required this.onTap});

  final Booking booking;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final b = booking;
    return TnCard(
      onTap: onTap,
      color: TnColors.navy,
      borderColor: TnColors.navy,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Text(
                'ACTIVE TOW',
                style: TextStyle(
                  color: TnColors.lime,
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.2,
                ),
              ),
              const Spacer(),
              Text(b.bookingNumber, style: const TextStyle(color: Colors.white70, fontSize: 12)),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            '${b.bookingNumber} · ${statusLabel(b.status)}',
            style: const TextStyle(
              color: TnColors.white,
              fontSize: 18,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            '${b.pickup.address} → ${b.dropoff.address}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: Colors.white70),
          ),
          const SizedBox(height: 12),
          const Row(
            children: [
              Text(
                'Track your tow',
                style: TextStyle(color: TnColors.lime, fontWeight: FontWeight.w800),
              ),
              SizedBox(width: 6),
              Icon(Icons.arrow_forward_rounded, color: TnColors.lime, size: 18),
            ],
          ),
        ],
      ),
    );
  }
}
