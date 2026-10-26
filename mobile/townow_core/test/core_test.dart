import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:townow_core/townow_core.dart';

Map<String, dynamic> sessionJson(String access, String refresh) => {
  'user': {'id': 'u1', 'phone': '+971501234567', 'role': 'customer', 'fullName': 'Aisha'},
  'accessToken': access,
  'refreshToken': refresh,
  'isNewUser': false,
};

void main() {
  group('ApiClient', () {
    test('signs in as a mobile client and stores the session', () async {
      late http.Request seen;
      final api = ApiClient(
        baseUrl: 'http://api/api/v1',
        sessions: MemorySessionStore(),
        role: 'customer',
        httpClient: MockClient((req) async {
          seen = req;
          return http.Response(jsonEncode(sessionJson('a1', 'r1')), 200);
        }),
      );
      final s = await api.verifyOtp('+971501234567', '123456');
      expect(s.user.fullName, 'Aisha');
      expect(api.accessToken, 'a1');
      expect(seen.headers['X-Client-Type'], 'mobile');
      expect(jsonDecode(seen.body), {
        'phone': '+971501234567',
        'code': '123456',
        'role': 'customer',
      });
    });

    test('refreshes once on 401 (concurrent calls share it) and retries', () async {
      final store = MemorySessionStore()..current = Session.fromJson(sessionJson('old', 'r1'));
      var refreshes = 0;
      final api = ApiClient(
        baseUrl: 'http://api/api/v1',
        sessions: store,
        role: 'customer',
        httpClient: MockClient((req) async {
          if (req.url.path.endsWith('/auth/refresh')) {
            refreshes++;
            expect(jsonDecode(req.body), {'refreshToken': 'r1', 'role': 'customer'});
            return http.Response(jsonEncode(sessionJson('new', 'r2')), 200);
          }
          return req.headers['Authorization'] == 'Bearer new'
              ? http.Response('{"ok":true}', 200)
              : http.Response('{"message":"Unauthorized"}', 401);
        }),
      );
      final results = await Future.wait([api.send('GET', '/a'), api.send('GET', '/b')]);
      expect(results, [
        {'ok': true},
        {'ok': true},
      ]);
      expect(refreshes, 1);
      expect(store.current!.refreshToken, 'r2');
    });

    test('a refused refresh signs out; API messages surface as ApiException', () async {
      final store = MemorySessionStore()..current = Session.fromJson(sessionJson('old', 'r1'));
      var signedOut = false;
      final api = ApiClient(
        baseUrl: 'http://api/api/v1',
        sessions: store,
        role: 'driver',
        httpClient: MockClient((req) async {
          if (req.url.path.endsWith('/auth/refresh')) return http.Response('{}', 401);
          if (req.url.path.endsWith('/conflict')) {
            return http.Response('{"message":["This tow is already completed."]}', 409);
          }
          return http.Response('{}', 401);
        }),
      )..onSignedOut = () => signedOut = true;
      await expectLater(
        api.send('GET', '/x'),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)),
      );
      expect(signedOut, isTrue);
      expect(store.current, isNull);

      await expectLater(
        api.send('GET', '/conflict', auth: false),
        throwsA(
          isA<ApiException>().having((e) => e.message, 'message', 'This tow is already completed.'),
        ),
      );
    });

    test('decodes JSON as UTF-8 even without a charset header', () async {
      final api = ApiClient(
        baseUrl: 'http://api/api/v1',
        sessions: MemorySessionStore(),
        role: 'customer',
        httpClient: MockClient(
          (_) async => http.Response.bytes(utf8.encode('{"notice":"TowNow’s TRN — مرحبا"}'), 200),
        ),
      );
      expect(await api.send('GET', '/x', auth: false), {'notice': 'TowNow’s TRN — مرحبا'});
    });

    test('network failures keep the session and explain the problem', () async {
      final store = MemorySessionStore()..current = Session.fromJson(sessionJson('a', 'r'));
      final api = ApiClient(
        baseUrl: 'http://api/api/v1',
        sessions: store,
        role: 'customer',
        httpClient: MockClient((req) async => throw http.ClientException('offline')),
      );
      await expectLater(
        api.send('GET', '/x'),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 0)),
      );
      expect(store.current, isNotNull);
    });
  });

  group('connection errors', () {
    test('server not running → "refused" message naming the server (real socket)', () async {
      // Nothing listens on port 1 here, so the OS refuses the connection.
      final api = ApiClient(
        baseUrl: 'http://127.0.0.1:1/api/v1',
        sessions: MemorySessionStore(),
        role: 'customer',
      );
      await expectLater(
        api.requestOtp('+971501234567'),
        throwsA(
          isA<ApiException>()
              .having((e) => e.status, 'status', 0)
              .having((e) => e.message, 'message', contains('(127.0.0.1:1) refused the connection')),
        ),
      );
    });

    test('unreachable network, failed lookup and other errors get distinct messages', () {
      String msg(Object e) => ApiClient.connectionErrorMessage(e, '192.168.1.4:4000');
      expect(msg(const SocketException('x', osError: OSError('', 101))), contains('from this network'));
      expect(msg(const SocketException("Failed host lookup: 'api.townow.ae'")), contains('No internet'));
      expect(
        msg(http.ClientException('boom')),
        'Cannot reach the TowNow server (192.168.1.4:4000). Check your connection.',
      );
    });

    test('HTTP 5xx without a message is reported as a server problem', () async {
      final api = ApiClient(
        baseUrl: 'http://api/api/v1',
        sessions: MemorySessionStore(),
        role: 'customer',
        httpClient: MockClient((_) async => http.Response('', 502)),
      );
      await expectLater(
        api.requestOtp('+971501234567'),
        throwsA(
          isA<ApiException>().having((e) => e.message, 'message', contains('server had a problem (HTTP 502)')),
        ),
      );
    });
  });

  group('models and formatting', () {
    test('parses a booking with driver, payment and rating', () {
      final b = Booking.fromJson({
        'id': 'b1',
        'bookingNumber': 'TN-100001',
        'status': 'completed',
        'createdAt': '2026-10-11T10:00:00.000Z',
        'vehicle': {
          'id': 'v1',
          'category': 'car',
          'brand': 'Toyota',
          'model': 'Land Cruiser',
          'year': 2022,
          'color': null,
          'plateEmirate': 'Dubai',
          'plateCode': 'K',
          'plateNumber': '12345',
          'isDefault': true,
        },
        'towType': 'flatbed',
        'issue': 'Breakdown',
        'pickup': {'lat': 25.1, 'lng': 55.2, 'address': 'Marina'},
        'dropoff': {'lat': 25.2, 'lng': 55.3, 'address': 'Garage'},
        'distanceMeters': 12000,
        'fare': {
          'baseFareFils': 15000,
          'distanceChargeFils': 9122,
          'subtotalFils': 24122,
          'vatRateBps': 500,
          'vatFils': 1206,
          'totalFils': 25328,
          'currency': 'AED',
        },
        'paymentMethod': 'cash',
        'canCancel': false,
        'driver': {
          'firstName': 'Hamdan',
          'rating': null,
          'totalTrips': 0,
          'truck': {
            'model': 'Isuzu NPR',
            'plateEmirate': 'Dubai',
            'plateCode': 'K',
            'plateNumber': '77412',
          },
        },
        'payment': {'method': 'cash', 'status': 'captured', 'amountFils': 25328},
        'myRating': {'rating': 5, 'comment': null, 'ratedAt': '2026-10-11T11:00:00.000Z'},
        'history': [
          {
            'fromStatus': null,
            'toStatus': 'requested',
            'note': null,
            'at': '2026-10-11T10:00:00.000Z',
          },
        ],
      });
      expect(b.isFinal, isTrue);
      expect(b.driver!.truckPlate, 'Dubai K 77412');
      expect(b.myRating, 5);
      expect(formatAed(b.fare.totalFils), 'AED 253.28');
      expect(b.history.single.toStatus, 'requested');
    });

    test('ETA label never invents a number', () {
      expect(
        DriverLocationView.fromJson({
          'status': 'driver_arriving',
          'location': null,
          'eta': null,
        }).etaLabel,
        'ETA unavailable',
      );
      expect(
        DriverLocationView.fromJson({
          'status': 'driver_arriving',
          'location': null,
          'eta': {'status': 'unavailable', 'reason': 'location_unavailable'},
        }).etaLabel,
        'Waiting for driver GPS',
      );
      expect(
        DriverLocationView.fromJson({
          'status': 'driver_arriving',
          'location': {'lat': 25.0, 'lng': 55.0, 'ageSeconds': 3, 'stale': false},
          'eta': {'status': 'available', 'durationSeconds': 430},
        }).etaLabel,
        'ETA 7 min',
      );
    });

    test('normalizes UAE mobiles and rejects others', () {
      expect(normalizeUaeMobile('050 123 4567'), '+971501234567');
      expect(normalizeUaeMobile('+971 55 765 4321'), '+971557654321');
      expect(normalizeUaeMobile('00971581234567'), '+971581234567');
      expect(normalizeUaeMobile('041234567'), isNull); // landline
      expect(normalizeUaeMobile('5012'), isNull);
    });

    test('tow type fit mirrors the API rule', () {
      expect(towTypeFits('car', 'flatbed'), isTrue);
      expect(towTypeFits('car', 'bike-carrier'), isFalse);
      expect(towTypeFits('motorbike', 'wheel-lift'), isFalse);
    });
  });
}
