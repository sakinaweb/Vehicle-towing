import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:townow_core/townow_core.dart';

import '../widgets.dart';
import 'tracking_screen.dart';
import 'vehicles_screen.dart';

/// One screen: vehicle → pickup (GPS by default) → destination → service, with a live server
/// quote and a single confirm (cash, or card when the server offers it). The fare always comes from the server; the app never
/// calculates a price.
class RequestScreen extends StatefulWidget {
  const RequestScreen({super.key, this.initialTowType});

  final String? initialTowType;

  @override
  State<RequestScreen> createState() => _RequestScreenState();
}

class _RequestScreenState extends State<RequestScreen> {
  List<Vehicle>? _vehicles;
  String? _loadError;
  Vehicle? _vehicle;
  late String _towType = widget.initialTowType ?? 'flatbed';
  Place? _pickup, _dropoff;
  final _pickupAddress = TextEditingController();
  final _dropoffAddress = TextEditingController();
  final _notes = TextEditingController();
  bool _locating = false;
  String? _gpsError;
  NearbyAvailability? _nearby;
  List<Place> _recent = const [];
  String _issue = vehicleIssues.first;

  Quote? _quote;
  String? _quotedFor; // _signature() the current quote was made for
  String? _quoteError;
  bool _quoting = false;
  int _quoteSeq = 0; // drops answers to superseded quote requests
  bool _booked = false;
  bool _cardAvailable = false; // only when the server says it accepts card
  String _paymentMethod = 'cash';

  @override
  void initState() {
    super.initState();
    _loadVehicles();
    _loadRecent();
    _loadPaymentMethods();
    _locate(replace: false);
  }

  Future<void> _loadPaymentMethods() async {
    try {
      final methods = await context.api.paymentMethods();
      if (mounted) setState(() => _cardAvailable = methods.contains('card'));
    } on ApiException {
      // Unknown → cash only, exactly as before.
    }
  }

  @override
  void dispose() {
    _pickupAddress.dispose();
    _dropoffAddress.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _loadVehicles() async {
    try {
      final list = await context.api.vehicles();
      if (!mounted) return;
      setState(() {
        _vehicles = list;
        _loadError = null;
        final wanted = serviceFor(_towType).category;
        _vehicle ??=
            list
                .where((v) => towTypeFits(v.category, _towType) && v.category == wanted)
                .firstOrNull ??
            list.where((v) => v.isDefault).firstOrNull ??
            list.firstOrNull;
        _fixTowType();
      });
      _requote();
    } on ApiException catch (e) {
      if (mounted) setState(() => _loadError = e.message);
    }
  }

  /// Recent destinations from the customer's own bookings (shortcuts only: the flow works
  /// without them).
  Future<void> _loadRecent() async {
    try {
      final list = await context.api.bookings();
      final seen = <String>{};
      final recent = [
        for (final b in list)
          if (seen.add(b.dropoff.address.trim().toLowerCase())) b.dropoff,
      ].take(4).toList();
      if (mounted) setState(() => _recent = recent);
    } on ApiException catch (_) {}
  }

  void _fixTowType() {
    final v = _vehicle;
    if (v != null && !towTypeFits(v.category, _towType)) {
      _towType = v.category == 'car' ? 'flatbed' : 'bike-carrier';
    }
  }

  /// GPS pickup. Asks for permission here, where the pickup is needed; on failure the
  /// customer can still search or pin the pickup. [replace] = false never overwrites a
  /// pickup the customer already chose by hand.
  Future<void> _locate({bool replace = true}) async {
    setState(() {
      _locating = true;
      _gpsError = null;
    });
    String? error;
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        error = 'Location is turned off. Turn it on, or search / pin your pickup.';
      } else {
        var perm = await Geolocator.checkPermission();
        if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
        if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
          error = 'No location access. Search or pin your pickup instead.';
        } else {
          // A fix from the last 2 minutes gives an instant pickup and price; the live fix
          // below replaces it unless the customer picked another pickup meanwhile.
          Place? quick;
          final last = await Geolocator.getLastKnownPosition();
          if (!mounted) return;
          if (last != null &&
              DateTime.now().difference(last.timestamp) < const Duration(minutes: 2) &&
              (replace || _pickup == null)) {
            quick = Place(lat: last.latitude, lng: last.longitude, address: 'My current location');
            _setPickup(quick);
          }
          final p = await Geolocator.getCurrentPosition().timeout(const Duration(seconds: 15));
          if (!mounted) return;
          final moved =
              quick == null ||
              Geolocator.distanceBetween(quick.lat, quick.lng, p.latitude, p.longitude) > 30;
          if (moved && (quick == null ? replace || _pickup == null : identical(_pickup, quick))) {
            _setPickup(Place(lat: p.latitude, lng: p.longitude, address: 'My current location'));
          }
        }
      }
    } catch (_) {
      error = 'Couldn\'t get your location. Search or pin your pickup instead.';
    }
    if (mounted) {
      setState(() {
        _locating = false;
        _gpsError = error;
      });
    }
  }

  void _setPickup(Place p) {
    setState(() {
      _pickup = p;
      _pickupAddress.text = p.address;
      _gpsError = null;
    });
    _requote();
    final api = context.api;
    api.nearby(p.lat, p.lng).then((n) {
      if (mounted) setState(() => _nearby = n);
    }, onError: (Object _) {});
  }

  void _setDropoff(Place p) {
    setState(() {
      _dropoff = p;
      _dropoffAddress.text = p.address;
    });
    _requote();
  }

  Future<void> _changePickup() async {
    final how = await showTnSheet<String>(
      context,
      builder: (ctx) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Where is your vehicle?', style: Theme.of(ctx).textTheme.titleLarge),
          const SizedBox(height: 8),
          InfoRow(
            key: const Key('pickup-gps'),
            icon: Icons.my_location_rounded,
            title: 'Use my current location',
            onTap: () => Navigator.pop(ctx, 'gps'),
          ),
          InfoRow(
            key: const Key('pickup-search'),
            icon: Icons.search_rounded,
            title: 'Search an address',
            onTap: () => Navigator.pop(ctx, 'search'),
          ),
          InfoRow(
            key: const Key('pickup-map'),
            icon: Icons.push_pin_rounded,
            title: 'Pin it on the map',
            onTap: () => Navigator.pop(ctx, 'map'),
          ),
        ],
      ),
    );
    if (!mounted || how == null) return;
    if (how == 'gps') return _locate();
    final p = how == 'search'
        ? await _search('Where is your vehicle?')
        : await _pickOnMap('Pin your pickup', _pickup);
    if (p != null) _setPickup(p);
  }

  Future<void> _pickDropoff({required bool map}) async {
    final p = map ? await _pickOnMap('Pin the destination', _pickup) : await _search('Where to?');
    if (p != null) _setDropoff(p);
  }

  /// Live server address search; the map pin stays one tap away in the same sheet.
  Future<Place?> _search(String title) async {
    final api = context.api;
    final picked = await showTnSheet<Object>(
      context,
      builder: (_) => _PlaceSearch(title: title, api: api),
    );
    if (!mounted) return null;
    return picked == _pinOnMap ? _pickOnMap(title, _pickup) : picked as Place?;
  }

  Future<Place?> _pickOnMap(String title, Place? near) => Navigator.of(context).push<Place>(
    MaterialPageRoute(
      builder: (_) => _MapPickerScreen(title: title, near: near),
    ),
  );

  /// The address typed for the driver, or the place's own label when left too short.
  Place _withText(Place p, TextEditingController c) {
    final text = c.text.trim();
    return Place(lat: p.lat, lng: p.lng, address: text.length >= 3 ? text : p.address);
  }

  String? _signature() {
    final v = _vehicle, p = _pickup, d = _dropoff;
    if (v == null || p == null || d == null) return null;
    final a = _withText(p, _pickupAddress), b = _withText(d, _dropoffAddress);
    return '${v.id}|$_towType|${a.lat},${a.lng},${a.address}|${b.lat},${b.lng},${b.address}';
  }

  /// Fetches the server quote as soon as vehicle, service, pickup and destination are known.
  Future<void> _requote() async {
    final sig = _signature();
    final seq = ++_quoteSeq;
    if (sig == null) {
      setState(() {
        _quote = null;
        _quoteError = null;
        _quoting = false;
      });
      return;
    }
    setState(() {
      _quoting = true;
      _quoteError = null;
    });
    try {
      final q = await context.api.quote(
        vehicleId: _vehicle!.id,
        towType: _towType,
        pickup: _withText(_pickup!, _pickupAddress),
        dropoff: _withText(_dropoff!, _dropoffAddress),
      );
      if (!mounted || seq != _quoteSeq) return;
      setState(() {
        _quote = q;
        _quotedFor = sig;
        _quoting = false;
      });
    } on ApiException catch (e) {
      if (!mounted || seq != _quoteSeq) return;
      setState(() {
        _quote = null;
        _quoteError = e.message;
        _quoting = false;
      });
    }
  }

  Future<void> _confirm() async {
    var q = _quote;
    if (q == null || _booked) return;
    // Edited addresses or an expired price hold → fresh quote. Never book a price the
    // customer hasn't seen.
    if (_signature() != _quotedFor || !q.expiresAt.isAfter(DateTime.now())) {
      final shown = q.fare.totalFils;
      await _requote();
      q = _quote;
      if (q == null || !mounted) return;
      if (q.fare.totalFils != shown) {
        context.toast('The price was updated. Check it and confirm again.', error: true);
        return;
      }
    }
    final quoteId = q.quoteId;
    final method = _cardAvailable ? _paymentMethod : 'cash';
    final navigator = Navigator.of(context);
    // The button stays busy while this runs, [_booked] covers taps during the page
    // transition, and the server books each quote only once.
    final booking = await context.guard(
      () => context.api.book(
        quoteId: quoteId,
        issue: _issue,
        notes: _notes.text.trim(),
        paymentMethod: method,
      ),
    );
    if (booking != null && mounted) {
      _booked = true;
      navigator.pushReplacement(
        MaterialPageRoute<void>(
          // Card: the tracking screen opens the card form straight away.
          builder: (_) => TrackingScreen(bookingId: booking.id, payNow: method == 'card'),
        ),
      );
    }
  }

  Future<void> _addVehicle() async {
    final added = await addVehicle(context);
    if (added != null) {
      _vehicle = added;
      _fixTowType();
      await _loadVehicles();
    }
  }

  @override
  Widget build(BuildContext context) {
    final vehicles = _vehicles;
    final q = _quote;
    return Scaffold(
      appBar: AppBar(title: const Text('Request a tow')),
      bottomNavigationBar: vehicles == null || vehicles.isEmpty
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
                child: TnButton(
                  key: const Key('book'),
                  label: q == null
                      ? 'Confirm booking'
                      : 'Confirm booking · ${formatAed(q.fare.totalFils)}',
                  icon: Icons.check_rounded,
                  onPressed: q == null || _quoting ? null : _confirm,
                ),
              ),
            ),
      body: vehicles == null
          ? (_loadError == null
                ? const SkeletonList(count: 3)
                : ErrorState(message: _loadError!, onRetry: _loadVehicles))
          : ListView(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
              children: [
                const SectionTitle('1 · Your vehicle'),
                if (vehicles.isEmpty)
                  TnCard(
                    child: EmptyState(
                      icon: Icons.directions_car_filled_rounded,
                      title: 'Add your vehicle',
                      message: 'We need its plate so the driver can find it.',
                      action: TnButton(
                        key: const Key('add-vehicle'),
                        label: 'Add vehicle',
                        icon: Icons.add_rounded,
                        onPressed: _addVehicle,
                      ),
                    ),
                  )
                else ...[
                  for (final x in vehicles) ...[
                    VehicleCard(
                      key: ValueKey('vehicle-${x.id}'),
                      vehicle: x,
                      selected: x.id == _vehicle?.id,
                      onTap: () {
                        setState(() {
                          _vehicle = x;
                          _fixTowType();
                        });
                        _requote();
                      },
                    ),
                    const SizedBox(height: 8),
                  ],
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      icon: const Icon(Icons.add_rounded),
                      label: const Text('Add another vehicle'),
                      onPressed: _addVehicle,
                    ),
                  ),
                ],
                if (vehicles.isNotEmpty) ...[
                  const SectionTitle('2 · Pickup'),
                  _pickupCard(),
                  const SectionTitle('3 · Destination'),
                  _dropoffCard(),
                  if (_vehicle != null) ...[
                    const SectionTitle('4 · Service'),
                    for (final s in towServices)
                      if (towTypeFits(_vehicle!.category, s.towType)) ...[
                        _ServiceOption(
                          service: s,
                          selected: _towType == s.towType,
                          nearby: _nearby?.byTowType[s.towType],
                          onTap: () {
                            setState(() => _towType = s.towType);
                            _requote();
                          },
                        ),
                        const SizedBox(height: 8),
                      ],
                  ],
                  const SectionTitle('Price & details'),
                  _summary(),
                ],
              ],
            ),
    );
  }

  Widget _pickupCard() {
    final p = _pickup;
    return TnCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InfoRow(
            key: const Key('use-location'),
            icon: p == null ? Icons.my_location_rounded : Icons.check_circle_rounded,
            iconBg: p == null ? TnColors.bg : TnColors.lime,
            title: p != null
                ? p.address
                : _locating
                ? 'Finding your location…'
                : 'Set your pickup',
            subtitle: p == null
                ? (_gpsError ?? 'We use your phone\'s GPS')
                : '${p.lat.toStringAsFixed(5)}, ${p.lng.toStringAsFixed(5)} · tap to change',
            trailing: _locating
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.edit_location_alt_rounded, color: TnColors.muted),
            onTap: _changePickup, // also while GPS is slow: search / pin stay one tap away,
          ),
          if (p != null) ...[
            const SizedBox(height: 10),
            TextField(
              controller: _pickupAddress,
              decoration: const InputDecoration(
                labelText: 'Pickup details for the driver',
                hintText: 'Landmark, street, parking level',
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _dropoffCard() {
    final p = _pickup, d = _dropoff;
    return TnCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_recent.isNotEmpty) ...[
            const Text('Recent', style: TextStyle(color: TnColors.muted, fontSize: 13)),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final (i, r) in _recent.indexed)
                  ChoiceChip(
                    key: Key('recent-$i'),
                    avatar: const Icon(Icons.history_rounded, size: 18),
                    label: Text(r.address, overflow: TextOverflow.ellipsis),
                    selected: d != null && d.lat == r.lat && d.lng == r.lng,
                    onSelected: (_) => _setDropoff(r),
                  ),
              ],
            ),
            const SizedBox(height: 10),
          ],
          InfoRow(
            key: const Key('search-destination'),
            icon: d == null ? Icons.search_rounded : Icons.flag_rounded,
            iconBg: d == null ? TnColors.bg : TnColors.lime,
            title: d == null ? 'Search destination address' : d.address,
            subtitle: d == null
                ? 'Garage, home or any UAE address'
                : '${d.lat.toStringAsFixed(5)}, ${d.lng.toStringAsFixed(5)} · tap to search again',
            onTap: () => _pickDropoff(map: false),
          ),
          InfoRow(
            key: const Key('pin-destination'),
            icon: Icons.push_pin_rounded,
            title: 'Pin it on the map',
            onTap: () => _pickDropoff(map: true),
          ),
          if (d != null) ...[
            const SizedBox(height: 10),
            TextField(
              controller: _dropoffAddress,
              decoration: const InputDecoration(
                labelText: 'Destination name',
                hintText: 'e.g. Al Quoz garage',
              ),
            ),
          ],
          if (p != null && d != null) ...[
            const SizedBox(height: 10),
            MapView(
              // Re-centres on the new points when either changes.
              key: ValueKey('${p.lat},${p.lng},${d.lat},${d.lng}'),
              height: 160,
              markers: [
                MapMarker('pickup', p.lat, p.lng, 'Pickup', icon: Icons.trip_origin),
                MapMarker(
                  'dropoff',
                  d.lat,
                  d.lng,
                  'Destination',
                  hue: 120,
                  icon: Icons.flag_rounded,
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _summary() {
    final q = _quote;
    if (_quoting && q == null) {
      return const TnCard(
        child: Row(
          children: [
            SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
            SizedBox(width: 12),
            Text('Getting your price…'),
          ],
        ),
      );
    }
    if (_quoteError != null) {
      return TnCard(
        child: ErrorState(message: _quoteError!, onRetry: _requote),
      );
    }
    if (q == null) {
      return const TnCard(
        child: InfoRow(
          icon: Icons.receipt_long_rounded,
          title: 'Your price appears here',
          subtitle: 'Set the pickup and destination to see it.',
        ),
      );
    }
    final f = q.fare;
    return TnCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(child: MoneyText(f.totalFils, size: 32)),
              if (_quoting)
                const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
            ],
          ),
          Text(
            '${serviceFor(q.towType).title} · ${formatKm(q.distanceMeters)} · price held until ${TimeOfDay.fromDateTime(q.expiresAt).format(context)}',
            style: const TextStyle(color: TnColors.muted),
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: TnColors.bg,
              borderRadius: BorderRadius.circular(TnRadius.md),
            ),
            child: Column(
              children: [
                KeyValueRow('Base fare', formatAed(f.baseFareFils)),
                KeyValueRow(
                  'Distance (${formatKm(q.distanceMeters)})',
                  formatAed(f.distanceChargeFils),
                ),
                if (f.otherChargesFils > 0)
                  KeyValueRow('Surcharges', formatAed(f.otherChargesFils)),
                KeyValueRow('VAT ${f.vatRateBps / 100}%', formatAed(f.vatFils)),
                const Divider(height: 18),
                KeyValueRow('Total', formatAed(f.totalFils), bold: true),
              ],
            ),
          ),
          const SizedBox(height: 14),
          const Text('What happened?', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final i in vehicleIssues)
                ChoiceChip(
                  label: Text(i),
                  selected: _issue == i,
                  onSelected: (_) => setState(() => _issue = i),
                ),
            ],
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _notes,
            decoration: const InputDecoration(
              labelText: 'Notes for the driver (optional)',
              hintText: 'e.g. Basement B2, near lift 3',
            ),
          ),
          const SizedBox(height: 12),
          if (!_cardAvailable)
            const InfoRow(
              icon: Icons.payments_rounded,
              iconBg: TnColors.lime,
              title: 'Cash on delivery',
              subtitle: 'Pay the driver when your vehicle is delivered',
            )
          else ...[
            const Text('How will you pay?', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              children: [
                ChoiceChip(
                  key: const Key('pay-cash'),
                  avatar: const Icon(Icons.payments_rounded, size: 18),
                  label: const Text('Cash'),
                  selected: _paymentMethod == 'cash',
                  onSelected: (_) => setState(() => _paymentMethod = 'cash'),
                ),
                ChoiceChip(
                  key: const Key('pay-card'),
                  avatar: const Icon(Icons.credit_card_rounded, size: 18),
                  label: const Text('Card'),
                  selected: _paymentMethod == 'card',
                  onSelected: (_) => setState(() => _paymentMethod = 'card'),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              _paymentMethod == 'cash'
                  ? 'Pay the driver when your vehicle is delivered'
                  : 'Your card is held now and charged only after delivery',
              style: const TextStyle(color: TnColors.muted, fontSize: 13),
            ),
          ],
        ],
      ),
    );
  }
}

class _ServiceOption extends StatelessWidget {
  const _ServiceOption({
    required this.service,
    required this.selected,
    required this.onTap,
    this.nearby,
  });

  final TowService service;
  final bool selected;
  final VoidCallback onTap;
  final ({int available, int? nearestMeters})? nearby;

  @override
  Widget build(BuildContext context) {
    return TnCard(
      onTap: onTap,
      borderColor: selected ? TnColors.navy : null,
      child: InfoRow(
        icon: service.icon,
        iconBg: selected ? TnColors.lime : TnColors.bg,
        title: service.title,
        subtitle: nearby == null
            ? service.subtitle
            : nearby!.available > 0
            ? '${nearby!.available} available · nearest ~${formatKm(nearby!.nearestMeters ?? 0)}'
            : 'None available nearby right now',
        trailing: Icon(
          selected ? Icons.radio_button_checked_rounded : Icons.radio_button_off_rounded,
          color: selected ? TnColors.navy : TnColors.border,
        ),
      ),
    );
  }
}

const _pinOnMap = 'map';

/// Address search sheet: results appear while typing and one tap picks one.
/// Pops a [Place], or [_pinOnMap] to pin the place on the map instead.
class _PlaceSearch extends StatefulWidget {
  const _PlaceSearch({required this.title, required this.api});

  final String title;
  final ApiClient api;

  @override
  State<_PlaceSearch> createState() => _PlaceSearchState();
}

class _PlaceSearchState extends State<_PlaceSearch> {
  Timer? _debounce;
  int _seq = 0; // drops answers to superseded searches
  bool _searching = false;
  List<Place> _results = const [];
  String? _message;

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  void _changed(String v) {
    _debounce?.cancel();
    final q = v.trim();
    if (q.length < 3) {
      _seq++;
      setState(() {
        _searching = false;
        _results = const [];
        _message = null;
      });
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 350), () => _run(q));
  }

  Future<void> _run(String q) async {
    final seq = ++_seq;
    setState(() => _searching = true);
    List<Place>? results;
    String? message;
    try {
      results = await widget.api.searchPlaces(q);
      if (results == null) {
        message = 'Address search isn\'t available. Pin the place on the map.';
      } else if (results.isEmpty) {
        message = 'No UAE address found for "$q".';
      }
    } on ApiException catch (e) {
      message = e.message;
    }
    if (!mounted || seq != _seq) return;
    setState(() {
      _searching = false;
      _results = results ?? const [];
      _message = message;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(widget.title, style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        TextField(
          key: const Key('place-search'),
          autofocus: true,
          textInputAction: TextInputAction.search,
          decoration: InputDecoration(
            hintText: 'Garage name, area or street',
            prefixIcon: const Icon(Icons.search_rounded),
            suffixIcon: _searching
                ? const Padding(
                    padding: EdgeInsets.all(14),
                    child: SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                : null,
          ),
          onChanged: _changed,
          onSubmitted: (v) {
            _debounce?.cancel();
            if (v.trim().length >= 3) _run(v.trim());
          },
        ),
        if (_message != null)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Text(_message!, style: const TextStyle(color: TnColors.muted)),
          ),
        const SizedBox(height: 8),
        for (final (i, r) in _results.indexed)
          InfoRow(
            key: Key('place-$i'),
            icon: Icons.place_rounded,
            title: r.address,
            onTap: () => Navigator.pop(context, r),
          ),
        InfoRow(
          key: const Key('search-pin'),
          icon: Icons.push_pin_rounded,
          title: 'Pin it on the map',
          onTap: () => Navigator.pop(context, _pinOnMap),
        ),
      ],
    );
  }
}

/// Full-screen map to pin a place (tap or long-press), with coordinate entry as a fallback.
class _MapPickerScreen extends StatefulWidget {
  const _MapPickerScreen({required this.title, this.near});

  final String title;

  /// Shown for reference and centred on (usually the pickup).
  final Place? near;

  @override
  State<_MapPickerScreen> createState() => _MapPickerScreenState();
}

class _MapPickerScreenState extends State<_MapPickerScreen> {
  final _lat = TextEditingController();
  final _lng = TextEditingController();

  @override
  void dispose() {
    _lat.dispose();
    _lng.dispose();
    super.dispose();
  }

  void _set(double lat, double lng) => setState(() {
    _lat.text = lat.toStringAsFixed(6);
    _lng.text = lng.toStringAsFixed(6);
  });

  @override
  Widget build(BuildContext context) {
    final lat = double.tryParse(_lat.text.trim()), lng = double.tryParse(_lng.text.trim());
    final valid = lat != null && lng != null && lat.abs() <= 90 && lng.abs() <= 180;
    final near = widget.near;
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
          child: TnButton(
            key: const Key('use-point'),
            label: 'Use this point',
            icon: Icons.check_rounded,
            onPressed: valid
                ? () async => Navigator.pop(
                    context,
                    Place(
                      lat: lat,
                      lng: lng,
                      address: 'Map pin ${lat.toStringAsFixed(5)}, ${lng.toStringAsFixed(5)}',
                    ),
                  )
                : null,
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          MapView(
            height: 380,
            markers: [
              if (near != null)
                MapMarker('near', near.lat, near.lng, 'Pickup', icon: Icons.trip_origin),
              if (valid)
                MapMarker('pin', lat, lng, 'Chosen point', hue: 120, icon: Icons.place_rounded),
            ],
            onTap: _set,
            onLongPress: _set,
          ),
          const SizedBox(height: 8),
          Text(
            'Tap the map to drop the pin, or enter coordinates.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: TextField(
                  key: const Key('pin-lat'),
                  controller: _lat,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
                  decoration: const InputDecoration(labelText: 'Latitude'),
                  onChanged: (_) => setState(() {}),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  key: const Key('pin-lng'),
                  controller: _lng,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
                  decoration: const InputDecoration(labelText: 'Longitude'),
                  onChanged: (_) => setState(() {}),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
