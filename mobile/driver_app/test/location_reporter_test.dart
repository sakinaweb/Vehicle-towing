import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:townow_core/townow_core.dart';
import 'package:townow_driver/location_reporter.dart';

/// GPS double: getCurrentPosition answers from [fixes] (the last one repeats, like a cached fix).
class FakeGeo extends GeolocatorPlatform {
  List<Position> fixes = [];
  Object? fail;
  int currentCalls = 0;
  LocationSettings? streamSettings;
  final stream = StreamController<Position>();

  @override
  Future<Position> getCurrentPosition({LocationSettings? locationSettings}) async {
    currentCalls++;
    if (fail != null) throw fail!;
    return fixes.length > 1 ? fixes.removeAt(0) : fixes.first;
  }

  @override
  Stream<Position> getPositionStream({LocationSettings? locationSettings}) {
    streamSettings = locationSettings;
    return stream.stream;
  }
}

Position fix(double lat, DateTime at) => Position(
  latitude: lat,
  longitude: 55.27,
  timestamp: at,
  accuracy: 5,
  altitude: 0,
  altitudeAccuracy: 0,
  heading: -1,
  headingAccuracy: 0,
  speed: 0,
  speedAccuracy: 0,
);

void main() {
  test('sends each GPS fix once with its own time; never re-sends a stale fix', () async {
    final geo = FakeGeo();
    GeolocatorPlatform.instance = geo;
    final posted = <Map<String, dynamic>>[];
    final api = ApiClient(
      baseUrl: 'http://api/api/v1',
      sessions: MemorySessionStore()
        ..current = Session(
          user: AppUser(id: 'u1', phone: '+971501112233', role: 'driver'),
          accessToken: 'a',
          refreshToken: 'r',
        ),
      role: 'driver',
      httpClient: MockClient((req) async {
        posted.add(jsonDecode(req.body) as Map<String, dynamic>);
        return http.Response('{}', 200);
      }),
    );
    final reporter = LocationReporter(api);
    final now = DateTime.now().toUtc();
    final old = now.subtract(const Duration(seconds: 60));
    List<Object?> sentTimes() => [for (final p in posted) p['recordedAt']];

    geo.fixes = [fix(25.1, old)];
    await reporter.start();
    expect(sentTimes(), [old.toIso8601String()]); // the fix's time, not "now"

    // Standing still: the phone hands back the same cached fix → nothing is sent.
    await reporter.heartbeat();
    expect(posted, hasLength(1));

    // A genuinely new fix is sent.
    geo.fixes = [fix(25.2, now)];
    await reporter.heartbeat();
    expect(sentTimes().last, now.toIso8601String());

    // The stream is fresh (< 25 s): the heartbeat doesn't even ask the GPS.
    final calls = geo.currentCalls;
    await reporter.heartbeat();
    expect(geo.currentCalls, calls);

    // Stream: newer fix sent, out-of-order older fix dropped.
    geo.stream.add(fix(25.3, now.add(const Duration(seconds: 1))));
    geo.stream.add(fix(25.0, old));
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);
    expect(posted.map((p) => p['lat']), [25.1, 25.2, 25.3]);

    // Android: the stream runs in a location foreground service with a visible notification.
    final s = geo.streamSettings;
    expect(s, isA<AndroidSettings>());
    expect((s as AndroidSettings).foregroundNotificationConfig?.notificationTitle, isNotEmpty);
    expect(s.distanceFilter, 25);

    reporter.stop();
    expect(reporter.running, isFalse);
  });

  test('no GPS fix → nothing is sent (no stale position reported as current)', () async {
    final geo = FakeGeo()..fixes = [fix(25.1, DateTime.now().toUtc())];
    GeolocatorPlatform.instance = geo;
    var posts = 0;
    final api = ApiClient(
      baseUrl: 'http://api/api/v1',
      sessions: MemorySessionStore()
        ..current = Session(
          user: AppUser(id: 'u1', phone: '+971501112233', role: 'driver'),
          accessToken: 'a',
          refreshToken: 'r',
        ),
      role: 'driver',
      httpClient: MockClient((_) async {
        posts++;
        return http.Response('{}', 200);
      }),
    );
    final reporter = LocationReporter(api);
    geo.fixes = [fix(25.1, DateTime.now().toUtc().subtract(const Duration(minutes: 5)))];
    await reporter.start();
    geo.fail = TimeoutException('no signal');
    await reporter.heartbeat();
    expect(posts, 1); // only the first real fix
    reporter.stop();
  });

  // Regression (POCO M3): a fix refused because the server didn't have the driver online yet
  // was counted as sent, so nothing reached the server until the driver moved.
  test('a refused or unsent fix is retried with a fresh one; a silent GPS never blocks start', () async {
    final now = DateTime.now().toUtc();
    final geo = FakeGeo()..fixes = [fix(25.1, now.subtract(const Duration(seconds: 40)))];
    GeolocatorPlatform.instance = geo;
    var refuse = true;
    final accepted = <Object?>[];
    final api = ApiClient(
      baseUrl: 'http://api/api/v1',
      sessions: MemorySessionStore()
        ..current = Session(
          user: AppUser(id: 'u1', phone: '+971501112233', role: 'driver'),
          accessToken: 'a',
          refreshToken: 'r',
        ),
      role: 'driver',
      httpClient: MockClient((req) async {
        if (refuse) return http.Response('{"message":"Go online to share your location."}', 409);
        accepted.add((jsonDecode(req.body) as Map<String, dynamic>)['lat']);
        return http.Response('{}', 200);
      }),
    );
    final reporter = LocationReporter(api);
    await reporter.start();
    expect(reporter.running, isTrue);
    expect(accepted, isEmpty);

    refuse = false;
    geo.fixes = [fix(25.2, now)];
    await reporter.heartbeat(); // not blocked by the refused fix
    expect(accepted, [25.2]);
    reporter.stop();

    // GPS that never answers: start() returns and reporting is running anyway.
    final silent = FakeGeo()..fail = TimeoutException('no fix indoors');
    GeolocatorPlatform.instance = silent;
    final r2 = LocationReporter(api);
    await r2.start();
    expect(r2.running, isTrue);
    r2.stop();
  });
}
