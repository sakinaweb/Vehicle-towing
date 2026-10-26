import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';
import 'package:townow_core/townow_core.dart';

/// Sends the driver's GPS position to the API while they are online or on a job.
/// The server throttles and validates fixes; it is the source of truth for matching.
///
/// Every fix is sent with the time it was taken (`recordedAt`), and a fix is sent at most
/// once — a position is never re-sent as if it were new. On Android the position stream runs
/// in a location foreground service (visible notification), so it keeps working while the
/// app is in the background or the screen is off. It starts while the app is open (going
/// online / on a job), which is what lets "while using the app" permission cover it — no
/// "allow all the time" permission is requested.
class LocationReporter {
  LocationReporter(this.api);

  final ApiClient api;
  StreamSubscription<Position>? _sub;
  Timer? _heartbeat;
  Position? _last;
  bool _fetching = false;

  static const _notifications = MethodChannel('ae.townow.driver/notifications');

  /// Stream settings: move ≥ 25 m and at most every 10 s (the API stores a fix every 15 s).
  @visibleForTesting
  static LocationSettings get streamSettings => defaultTargetPlatform == TargetPlatform.android
      ? AndroidSettings(
          accuracy: LocationAccuracy.high,
          distanceFilter: 25,
          intervalDuration: const Duration(seconds: 10),
          foregroundNotificationConfig: const ForegroundNotificationConfig(
            notificationTitle: 'TowNow Driver is sharing your location',
            notificationText: 'Dispatch sees your position while you are online or on a job. '
                'Go offline to stop.',
            notificationChannelName: 'Location while online',
            setOngoing: true,
          ),
        )
      : const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 25);

  bool get running => _sub != null;

  /// Asks for permission. Returns an error message to show, or null when allowed.
  static Future<String?> ensurePermission() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return 'Turn on Location services to go online.';
    }
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
    if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
      return 'TowNow needs your location to send you nearby tow requests.';
    }
    // Android 13+: lets the "sharing your location" notification show. Optional — tracking
    // works without it, the notification is just hidden from the shade.
    try {
      await _notifications.invokeMethod<void>('request');
    } on MissingPluginException {
      // not Android
    } on PlatformException {
      // ignore: the permission is optional
    }
    return null;
  }

  /// Android: asks to run without battery restrictions, so the phone doesn't stop GPS
  /// in the background. No-op once allowed (and on other platforms).
  static Future<void> requestBatteryExemption() async {
    try {
      await _notifications.invokeMethod<bool>('battery');
    } on MissingPluginException {
      // not Android
    } on PlatformException {
      // optional
    }
  }

  Future<void> start() async {
    if (running) return;
    final first = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
    );
    await _send(first);
    _sub = Geolocator.getPositionStream(locationSettings: streamSettings)
        .listen(_send, onError: (_) {});
    // Standing still produces no stream events; take a fresh fix instead of re-sending an old one.
    _heartbeat = Timer.periodic(const Duration(seconds: 30), (_) => heartbeat());
  }

  /// When the stream has been quiet, asks for one fresh fix. If none comes, nothing is sent:
  /// the server then shows the position as old instead of us pretending it is current.
  @visibleForTesting
  Future<void> heartbeat() async {
    final last = _last;
    if (_fetching) return;
    if (last != null && DateTime.now().difference(last.timestamp) < const Duration(seconds: 25)) {
      return; // the stream is delivering
    }
    _fetching = true;
    try {
      await _send(
        await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            timeLimit: Duration(seconds: 20),
          ),
        ),
      );
    } catch (_) {
      // No fix (no signal, GPS off, timeout).
    } finally {
      _fetching = false;
    }
  }

  Future<void> _send(Position p) async {
    final last = _last;
    if (last != null && !p.timestamp.isAfter(last.timestamp)) return; // not a new fix
    _last = p;
    try {
      await api.postLocation(
        p.latitude,
        p.longitude,
        accuracy: p.accuracy,
        heading: p.heading >= 0 ? p.heading : null,
        recordedAt: p.timestamp,
      );
    } on ApiException {
      // Throttled, too old or offline: the next real fix is sent anyway.
    }
  }

  void stop() {
    _sub?.cancel(); // also ends the Android foreground service and its notification
    _heartbeat?.cancel();
    _sub = null;
    _heartbeat = null;
  }
}
