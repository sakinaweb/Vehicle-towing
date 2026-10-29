import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart' as gm;
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config.dart';
import '../models.dart';
import 'design.dart';

class MapMarker {
  const MapMarker(
    this.id,
    this.lat,
    this.lng,
    this.label, {
    this.hue = gm.BitmapDescriptor.hueRed,
    this.icon = Icons.place_rounded,
    this.note,
  });

  final String id;
  final double lat, lng;
  final String label;

  /// Marker colour as an HSV hue (0–360), shared by both map renderers.
  final double hue;
  final IconData icon;
  final String? note;
}

const _dubai = LatLng(25.2048, 55.2708);

/// OpenStreetMap tiles by default (tile URL configurable in [TowNowConfig.mapTileUrl]);
/// Google Maps instead when GOOGLE_MAPS_ENABLED and a key are configured.
class MapView extends StatelessWidget {
  const MapView({
    super.key,
    required this.markers,
    this.height = 260,
    this.onLongPress,
    this.onTap,
  });

  /// The app's identity for tile requests (OSM tile policy blocks generic User-Agents).
  /// Each app sets it in main().
  static String userAgentPackageName = 'ae.townow';

  final List<MapMarker> markers;
  final double height;

  /// Lets the user pick a point (e.g. the destination).
  final void Function(double lat, double lng)? onLongPress;

  /// Same as [onLongPress] for a plain tap (map pickers).
  final void Function(double lat, double lng)? onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(TnRadius.lg),
        child: TowNowConfig.mapsEnabled
            ? _google()
            : _OsmMap(markers: markers, onLongPress: onLongPress, onTap: onTap),
      ),
    );
  }

  Widget _google() {
    final center = markers.isEmpty
        ? gm.LatLng(_dubai.latitude, _dubai.longitude)
        : gm.LatLng(markers.first.lat, markers.first.lng);
    return gm.GoogleMap(
      initialCameraPosition: gm.CameraPosition(target: center, zoom: 12),
      myLocationEnabled: true,
      myLocationButtonEnabled: true,
      onLongPress: onLongPress == null ? null : (p) => onLongPress!(p.latitude, p.longitude),
      onTap: onTap == null ? null : (p) => onTap!(p.latitude, p.longitude),
      markers: {
        for (final m in markers)
          gm.Marker(
            markerId: gm.MarkerId(m.id),
            position: gm.LatLng(m.lat, m.lng),
            infoWindow: gm.InfoWindow(title: m.label),
            icon: gm.BitmapDescriptor.defaultMarkerWithHue(m.hue),
          ),
      },
    );
  }
}

/// Tile loading state shown over the map. Retry is manual only: no automatic re-fetch loops
/// against the tile server (OSM tile policy).
enum _TileState { loading, loaded, failed }

class _OsmMap extends StatefulWidget {
  const _OsmMap({required this.markers, this.onLongPress, this.onTap});

  final List<MapMarker> markers;
  final void Function(double lat, double lng)? onLongPress;
  final void Function(double lat, double lng)? onTap;

  @override
  State<_OsmMap> createState() => _OsmMapState();
}

class _OsmMapState extends State<_OsmMap> {
  /// Failed tiles in a row (no tile loaded in between) before the error card shows.
  static const _failuresToShowError = 3;

  /// No tile at all after this long (hanging network) also counts as failed.
  static const _loadTimeout = Duration(seconds: 20);

  var _state = _TileState.loading;
  var _failuresInRow = 0;
  var _attempt = 0; // bumps the TileLayer key so Retry reloads every tile
  Timer? _timeout;

  @override
  void initState() {
    super.initState();
    _armTimeout();
  }

  @override
  void dispose() {
    _timeout?.cancel();
    super.dispose();
  }

  void _armTimeout() {
    _timeout?.cancel();
    _timeout = Timer(_loadTimeout, () {
      if (mounted && _state == _TileState.loading) setState(() => _state = _TileState.failed);
    });
  }

  void _set(_TileState s) {
    if (s == _state) return;
    // Tile callbacks arrive during build/layout: apply after the frame.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && s != _state) setState(() => _state = s);
    });
  }

  void _tileLoaded() {
    _failuresInRow = 0;
    _timeout?.cancel();
    _set(_TileState.loaded);
  }

  void _tileFailed() {
    if (++_failuresInRow >= _failuresToShowError) _set(_TileState.failed);
  }

  void _retry() {
    setState(() {
      _attempt++;
      _failuresInRow = 0;
      _state = _TileState.loading;
    });
    _armTimeout();
  }

  @override
  Widget build(BuildContext context) {
    final points = [for (final m in widget.markers) LatLng(m.lat, m.lng)];
    final onLongPress = widget.onLongPress;
    final onTap = widget.onTap;
    return Stack(
      children: [
        FlutterMap(
          options: MapOptions(
            backgroundColor: TnColors.bg,
            initialCenter: points.isEmpty ? _dubai : points.first,
            initialZoom: points.isEmpty ? 11 : 14,
            initialCameraFit: points.length > 1
                ? CameraFit.coordinates(
                    coordinates: points,
                    padding: const EdgeInsets.all(48),
                    maxZoom: 15,
                  )
                : null,
            onLongPress: onLongPress == null
                ? null
                : (_, p) => onLongPress(p.latitude, p.longitude),
            onTap: onTap == null ? null : (_, p) => onTap(p.latitude, p.longitude),
          ),
          children: [
            TileLayer(
              key: ValueKey(_attempt),
              urlTemplate: TowNowConfig.mapTileUrl,
              userAgentPackageName: MapView.userAgentPackageName,
              maxZoom: 19,
              errorTileCallback: (_, _, _) => _tileFailed(),
              tileBuilder: (context, tile, image) {
                if (image.loadFinishedAt != null && !image.loadError) _tileLoaded();
                return tile;
              },
            ),
            MarkerLayer(
              markers: [
                for (final m in widget.markers)
                  Marker(
                    point: LatLng(m.lat, m.lng),
                    width: 36,
                    height: 36,
                    child: Tooltip(message: m.label, child: _Pin(m)),
                  ),
              ],
            ),
            // Always visible (OSM attribution must not sit behind a toggle).
            SimpleAttributionWidget(
              source: const Text(TowNowConfig.mapAttribution),
              onTap: () => launchUrl(
                Uri.parse('https://www.openstreetmap.org/copyright'),
                mode: LaunchMode.externalApplication,
              ),
            ),
          ],
        ),
        if (_state == _TileState.loading)
          const Positioned(top: 10, left: 10, child: _MapNotice.loading()),
        if (_state == _TileState.failed)
          Positioned(top: 10, left: 10, right: 10, child: _MapNotice.failed(onRetry: _retry)),
      ],
    );
  }
}

/// Small card over the map; never covers the bottom edge where the attribution sits.
class _MapNotice extends StatelessWidget {
  const _MapNotice.loading() : onRetry = null;
  const _MapNotice.failed({required this.onRetry});

  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final failed = onRetry != null;
    return Container(
      padding: EdgeInsets.fromLTRB(12, failed ? 6 : 8, failed ? 4 : 12, failed ? 6 : 8),
      decoration: BoxDecoration(
        color: TnColors.white.withValues(alpha: 0.95),
        borderRadius: BorderRadius.circular(TnRadius.md),
        border: Border.all(color: TnColors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (failed)
            const Icon(Icons.cloud_off_rounded, size: 18, color: TnColors.error)
          else
            const SizedBox.square(
              dimension: 14,
              child: CircularProgressIndicator(strokeWidth: 2, color: TnColors.navy),
            ),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              failed ? 'Map couldn\'t load. Check your connection.' : 'Loading map…',
              style: const TextStyle(
                color: TnColors.text,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          if (failed) TextButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}

class _Pin extends StatelessWidget {
  const _Pin(this.m);

  final MapMarker m;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: HSVColor.fromAHSV(1, m.hue % 360, 0.8, 0.75).toColor(),
        shape: BoxShape.circle,
        border: Border.all(color: TnColors.white, width: 3),
        boxShadow: const [BoxShadow(color: Color(0x33101827), blurRadius: 6, offset: Offset(0, 2))],
      ),
      child: Icon(m.icon, size: 16, color: TnColors.white),
    );
  }
}

/// Opens turn-by-turn navigation in Google Maps (or the browser) to a place.
Future<void> navigateTo(Place p) async {
  final uri = Uri.parse(
    'https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving',
  );
  await launchUrl(uri, mode: LaunchMode.externalApplication);
}

/// Phone dialer (support / emergency). No-op if the device can't place calls.
Future<void> callNumber(String number) async {
  await launchUrl(Uri(scheme: 'tel', path: number));
}
