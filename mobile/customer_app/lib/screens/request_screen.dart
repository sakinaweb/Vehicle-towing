import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:townow_core/townow_core.dart';

import '../widgets.dart';
import 'tracking_screen.dart';
import 'vehicles_screen.dart';

/// Vehicle → service → pickup (GPS) → destination → server quote → confirm (cash).
/// The fare always comes from the server; the app never calculates a price.
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
  final _pickupAddress = TextEditingController();
  final _dropoffAddress = TextEditingController();
  final _dropLat = TextEditingController();
  final _dropLng = TextEditingController();
  double? _pickLat, _pickLng;
  bool _locating = false;
  NearbyAvailability? _nearby;

  @override
  void initState() {
    super.initState();
    _loadVehicles();
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
    } on ApiException catch (e) {
      if (mounted) setState(() => _loadError = e.message);
    }
  }

  void _fixTowType() {
    final v = _vehicle;
    if (v != null && !towTypeFits(v.category, _towType)) {
      _towType = v.category == 'car' ? 'flatbed' : 'bike-carrier';
    }
  }

  Future<void> _useMyLocation() async {
    setState(() => _locating = true);
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        if (mounted) context.toast('Turn on Location services on your phone.', error: true);
        return;
      }
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
        if (mounted) context.toast('Allow location access to set your pickup.', error: true);
        return;
      }
      final p = await Geolocator.getCurrentPosition().timeout(const Duration(seconds: 15));
      if (!mounted) return;
      setState(() {
        _pickLat = p.latitude;
        _pickLng = p.longitude;
        if (_pickupAddress.text.isEmpty) _pickupAddress.text = 'My current location';
      });
      context.toast('Pickup set to your current location', success: true);
      final api = context.api;
      api.nearby(p.latitude, p.longitude).then((n) {
        if (mounted) setState(() => _nearby = n);
      }, onError: (Object _) {});
    } catch (_) {
      if (mounted) context.toast('Couldn\'t get your location. Try again outdoors.', error: true);
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  Future<void> _searchDestination() async {
    final api = context.api;
    final c = TextEditingController();
    final q = await showTnSheet<String>(
      context,
      builder: (ctx) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Where to?', style: Theme.of(ctx).textTheme.titleLarge),
          const SizedBox(height: 12),
          TextField(
            controller: c,
            autofocus: true,
            decoration: const InputDecoration(
              hintText: 'Garage name, area or street',
              prefixIcon: Icon(Icons.search_rounded),
            ),
            onSubmitted: (v) => Navigator.pop(ctx, v.trim()),
          ),
          const SizedBox(height: 12),
          TnButton(label: 'Search', onPressed: () async => Navigator.pop(ctx, c.text.trim())),
        ],
      ),
    );
    if (q == null || q.length < 3 || !mounted) return;
    final results = await context.guard(() => api.searchPlaces(q));
    if (!mounted) return;
    if (results == null) {
      context.toast(
        'Address search isn\'t configured yet. Enter coordinates instead.',
        error: true,
      );
      return;
    }
    if (results.isEmpty) {
      context.toast('No UAE address found for "$q".', error: true);
      return;
    }
    final picked = await showTnSheet<Place>(
      context,
      builder: (ctx) => Column(
        children: [
          for (final r in results)
            InfoRow(
              icon: Icons.place_rounded,
              title: r.address,
              onTap: () => Navigator.pop(ctx, r),
            ),
        ],
      ),
    );
    if (picked == null) return;
    setState(() {
      _dropLat.text = picked.lat.toStringAsFixed(6);
      _dropLng.text = picked.lng.toStringAsFixed(6);
      _dropoffAddress.text = picked.address;
    });
  }

  Future<void> _getQuote() async {
    final v = _vehicle;
    final dLat = double.tryParse(_dropLat.text.trim());
    final dLng = double.tryParse(_dropLng.text.trim());
    if (v == null) return context.toast('Choose your vehicle first.', error: true);
    if (_pickLat == null) return context.toast('Set your pickup location.', error: true);
    if (dLat == null || dLng == null) {
      return context.toast('Set the destination.', error: true);
    }
    if (_pickupAddress.text.trim().length < 3 || _dropoffAddress.text.trim().length < 3) {
      return context.toast('Add a short description of both places for the driver.', error: true);
    }
    final q = await context.guard(
      () => context.api.quote(
        vehicleId: v.id,
        towType: _towType,
        pickup: Place(lat: _pickLat!, lng: _pickLng!, address: _pickupAddress.text.trim()),
        dropoff: Place(lat: dLat, lng: dLng, address: _dropoffAddress.text.trim()),
      ),
    );
    if (q == null || !mounted) return;
    final booking = await showTnSheet<Booking>(
      context,
      builder: (_) => AppScope(
        api: context.api,
        realtime: context.realtime,
        child: _ConfirmSheet(quote: q, vehicle: v),
      ),
    );
    if (booking != null && mounted) {
      Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(builder: (_) => TrackingScreen(bookingId: booking.id)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final vehicles = _vehicles;
    final dLat = double.tryParse(_dropLat.text), dLng = double.tryParse(_dropLng.text);
    return Scaffold(
      appBar: AppBar(title: const Text('Request a tow')),
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
                        label: 'Add vehicle',
                        icon: Icons.add_rounded,
                        onPressed: () async {
                          final added = await addVehicle(context);
                          if (added != null) {
                            _vehicle = added;
                            await _loadVehicles();
                          }
                        },
                      ),
                    ),
                  )
                else ...[
                  for (final x in vehicles) ...[
                    VehicleCard(
                      key: ValueKey('vehicle-${x.id}'),
                      vehicle: x,
                      selected: x.id == _vehicle?.id,
                      onTap: () => setState(() {
                        _vehicle = x;
                        _fixTowType();
                      }),
                    ),
                    const SizedBox(height: 8),
                  ],
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      icon: const Icon(Icons.add_rounded),
                      label: const Text('Add another vehicle'),
                      onPressed: () async {
                        final added = await addVehicle(context);
                        if (added != null) {
                          _vehicle = added;
                          await _loadVehicles();
                        }
                      },
                    ),
                  ),
                ],
                if (_vehicle != null) ...[
                  const SectionTitle('2 · Service'),
                  for (final s in towServices)
                    if (towTypeFits(_vehicle!.category, s.towType)) ...[
                      _ServiceOption(
                        service: s,
                        selected: _towType == s.towType,
                        nearby: _nearby?.byTowType[s.towType],
                        onTap: () => setState(() => _towType = s.towType),
                      ),
                      const SizedBox(height: 8),
                    ],
                ],
                const SectionTitle('3 · Pickup'),
                TnCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      InfoRow(
                        key: const Key('use-location'),
                        icon: _pickLat == null
                            ? Icons.my_location_rounded
                            : Icons.check_circle_rounded,
                        iconBg: _pickLat == null ? TnColors.bg : TnColors.lime,
                        title: _pickLat == null ? 'Use my current location' : 'Pickup set',
                        subtitle: _pickLat == null
                            ? 'We use your phone\'s GPS'
                            : '${_pickLat!.toStringAsFixed(5)}, ${_pickLng!.toStringAsFixed(5)} · tap to update',
                        trailing: _locating
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : null,
                        onTap: _locating ? null : _useMyLocation,
                      ),
                      const SizedBox(height: 10),
                      TextField(
                        controller: _pickupAddress,
                        decoration: const InputDecoration(
                          labelText: 'Pickup details',
                          hintText: 'Landmark, street, parking level',
                        ),
                      ),
                    ],
                  ),
                ),
                const SectionTitle('4 · Destination'),
                TnCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      InfoRow(
                        key: const Key('search-destination'),
                        icon: Icons.search_rounded,
                        title: _dropoffAddress.text.isEmpty
                            ? 'Search destination address'
                            : _dropoffAddress.text,
                        subtitle: 'Garage, home or any UAE address',
                        onTap: _searchDestination,
                      ),
                      const SizedBox(height: 10),
                      MapView(
                        height: 220,
                        markers: [
                          if (_pickLat != null)
                            MapMarker(
                              'pickup',
                              _pickLat!,
                              _pickLng!,
                              'Pickup',
                              icon: Icons.trip_origin,
                            ),
                          if (dLat != null && dLng != null)
                            MapMarker(
                              'dropoff',
                              dLat,
                              dLng,
                              'Destination',
                              hue: 120,
                              icon: Icons.flag_rounded,
                            ),
                        ],
                        onLongPress: (lat, lng) => setState(() {
                          _dropLat.text = lat.toStringAsFixed(6);
                          _dropLng.text = lng.toStringAsFixed(6);
                        }),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Long-press the map to drop the destination pin.',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: _dropLat,
                              keyboardType: const TextInputType.numberWithOptions(
                                decimal: true,
                                signed: true,
                              ),
                              decoration: const InputDecoration(labelText: 'Latitude'),
                              onChanged: (_) => setState(() {}),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: TextField(
                              controller: _dropLng,
                              keyboardType: const TextInputType.numberWithOptions(
                                decimal: true,
                                signed: true,
                              ),
                              decoration: const InputDecoration(labelText: 'Longitude'),
                              onChanged: (_) => setState(() {}),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      TextField(
                        controller: _dropoffAddress,
                        decoration: const InputDecoration(
                          labelText: 'Destination name',
                          hintText: 'e.g. Al Quoz garage',
                        ),
                        onChanged: (_) => setState(() {}),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),
                TnButton(
                  key: const Key('get-quote'),
                  label: 'See price',
                  icon: Icons.receipt_long_rounded,
                  onPressed: vehicles.isEmpty ? null : _getQuote,
                ),
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

/// Price, breakdown and the final confirmation. Returns the created booking.
class _ConfirmSheet extends StatefulWidget {
  const _ConfirmSheet({required this.quote, required this.vehicle});

  final Quote quote;
  final Vehicle vehicle;

  @override
  State<_ConfirmSheet> createState() => _ConfirmSheetState();
}

class _ConfirmSheetState extends State<_ConfirmSheet> {
  String _issue = vehicleIssues.first;
  final _notes = TextEditingController();

  @override
  Widget build(BuildContext context) {
    final q = widget.quote;
    final f = q.fare;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(serviceFor(q.towType).title, style: const TextStyle(color: TnColors.muted)),
        const SizedBox(height: 4),
        MoneyText(f.totalFils, size: 36),
        Text(
          '${formatKm(q.distanceMeters)} · price held until ${TimeOfDay.fromDateTime(q.expiresAt).format(context)}',
          style: const TextStyle(color: TnColors.muted),
        ),
        const SizedBox(height: 16),
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
              if (f.otherChargesFils > 0) KeyValueRow('Surcharges', formatAed(f.otherChargesFils)),
              KeyValueRow('VAT ${f.vatRateBps / 100}%', formatAed(f.vatFils)),
              const Divider(height: 18),
              KeyValueRow('Total', formatAed(f.totalFils), bold: true),
            ],
          ),
        ),
        const SizedBox(height: 16),
        DropdownButtonFormField<String>(
          initialValue: _issue,
          decoration: const InputDecoration(labelText: 'What happened?'),
          items: [for (final i in vehicleIssues) DropdownMenuItem(value: i, child: Text(i))],
          onChanged: (i) => setState(() => _issue = i!),
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
        const InfoRow(
          icon: Icons.payments_rounded,
          iconBg: TnColors.lime,
          title: 'Cash on delivery',
          subtitle: 'Pay the driver when your vehicle is delivered',
        ),
        const SizedBox(height: 12),
        TnButton(
          key: const Key('book'),
          label: 'Confirm booking · ${formatAed(f.totalFils)}',
          onPressed: () async {
            final navigator = Navigator.of(context);
            final booking = await context.guard(
              () => context.api.book(quoteId: q.quoteId, issue: _issue, notes: _notes.text.trim()),
            );
            if (booking != null) navigator.pop(booking);
          },
        ),
      ],
    );
  }
}
