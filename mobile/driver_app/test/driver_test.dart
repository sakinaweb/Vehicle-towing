import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:townow_core/townow_core.dart';
import 'package:townow_driver/screens/job_screen.dart';
import 'package:townow_driver/screens/work_screen.dart';

Map<String, dynamic> profile({String kyc = 'approved', String availability = 'offline'}) => {
  'user': {'id': 'u1', 'phone': '+971501112233', 'role': 'driver', 'fullName': 'Hamdan Al Ketbi'},
  'kycStatus': kyc,
  'kycRejectionReason': null,
  'availability': availability,
  'rating': null,
  'totalTrips': 0,
  'experienceYears': 6,
  'acceptanceRate': null,
  'towTrucks': <Object>[],
};

Map<String, dynamic> job({
  String status = 'driver_assigned',
  String pickup = 'none',
  String ret = 'none',
  Map<String, dynamic> extra = const {},
}) => {
  'bookingId': 'b1',
  'bookingNumber': 'TN-100326',
  'status': status,
  'towType': 'flatbed',
  'issue': 'Breakdown',
  'notes': null,
  'vehicle': {
    'category': 'car',
    'brand': 'Toyota',
    'model': 'Land Cruiser',
    'color': null,
    'plate': 'Dubai K 12345',
  },
  'pickup': {'lat': 25.08, 'lng': 55.14, 'address': 'Dubai Marina'},
  'dropoff': {'lat': 25.12, 'lng': 55.2, 'address': 'Al Quoz garage'},
  'tripDistanceMeters': 9100,
  'fareTotalFils': 25328,
  'driverPayoutFils': 19298,
  'currency': 'AED',
  'customerFirstName': 'Aisha',
  'paymentMethod': 'cash',
  'inspections': {'pickup': pickup, 'return': ret},
  ...extra,
};

/// API double: answers by "METHOD path"; records every call.
class FakeApi {
  FakeApi(this.routes);

  final Map<String, Object? Function(http.Request)> routes;
  final calls = <String>[];

  ApiClient client() {
    final sessions = MemorySessionStore()
      ..current = Session(
        user: AppUser(id: 'u1', phone: '+971501112233', role: 'driver'),
        accessToken: 'a',
        refreshToken: 'r',
      );
    return ApiClient(
      baseUrl: 'http://api/api/v1',
      sessions: sessions,
      role: 'driver',
      httpClient: MockClient((req) async {
        final key = '${req.method} ${req.url.path.replaceFirst('/api/v1', '')}';
        calls.add(key);
        final handler = routes[key];
        if (handler == null) return http.Response('{"message":"not mocked: $key"}', 404);
        return http.Response.bytes(utf8.encode(jsonEncode(handler(req))), 200);
      }),
    );
  }
}

/// Phone-sized screen so whole job screens build.
void phone(WidgetTester tester) {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

Widget host(ApiClient api, Widget child) => AppScope(
  api: api,
  realtime: Realtime(api),
  child: MaterialApp(
    theme: townowTheme(),
    home: Scaffold(body: child),
  ),
);

void main() {
  testWidgets('unverified drivers are sent to verification and cannot go online', (tester) async {
    phone(tester);
    final api = FakeApi({
      'GET /drivers/me': (_) => profile(kyc: 'pending'),
      'GET /drivers/me/jobs/current': (_) => {'job': null},
      'GET /drivers/me/offers/current': (_) => {'offer': null},
      'GET /drivers/me/earnings': (_) => {
        'balanceFils': -5606,
        'currency': 'AED',
        'entries': [
          {
            'id': 'l1',
            'bookingId': 'b0',
            'type': 'trip_earning',
            'reference': null,
            'amountFils': 17942,
            'details': <String, Object>{},
            'createdAt': DateTime.now().toUtc().toIso8601String(),
          },
          {
            'id': 'l0',
            'bookingId': 'b9',
            'type': 'trip_earning',
            'reference': null,
            'amountFils': 9999,
            'details': <String, Object>{},
            'createdAt': '2026-01-01T10:00:00Z',
          },
        ],
      },
    });
    await tester.pumpWidget(host(api.client(), const WorkScreen()));
    await tester.pump(const Duration(milliseconds: 200));
    await tester.pump(const Duration(milliseconds: 200));
    expect(find.text('Verification pending'), findsOneWidget);
    // Today's stats come from the real ledger: only today's trip counts.
    expect(find.text('AED 179.42'), findsOneWidget);
    expect(find.text('1'), findsOneWidget);
    expect(find.text('Complete verification'), findsOneWidget);
    expect(find.byKey(const Key('online')), findsNothing);
  });

  testWidgets('shows an incoming offer with the payout and accepts it', (tester) async {
    phone(tester);
    var accepted = false;
    final api = FakeApi({
      'GET /drivers/me': (_) => profile(availability: 'busy'),
      'GET /drivers/me/jobs/current': (_) => {'job': accepted ? job() : null},
      'GET /drivers/me/offers/current': (_) => {
        'offer': accepted
            ? null
            : job(
                extra: {
                  'offerId': 'o1',
                  'offerStatus': 'pending',
                  'distanceToPickupMeters': 2300,
                  'expiresAt': DateTime.now()
                      .add(const Duration(seconds: 30))
                      .toUtc()
                      .toIso8601String(),
                },
              ),
      },
      'POST /drivers/me/offers/o1/accept': (_) {
        accepted = true;
        return job();
      },
    });
    // Online already (e.g. app restart): skip GPS by marking the profile busy with no device location.
    await tester.pumpWidget(host(api.client(), const WorkScreen()));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump();
    expect(find.text('New tow request'), findsOneWidget);
    expect(find.textContaining('AED 192.98'), findsOneWidget);
    await tester.tap(find.byKey(const Key('accept')));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump();
    expect(api.calls, contains('POST /drivers/me/offers/o1/accept'));
    expect(find.text('Start driving to pickup'), findsOneWidget);
    await tester.pumpWidget(const SizedBox()); // dispose timers
  }, skip: false);

  testWidgets('start-tow stays disabled until the pickup inspection is submitted', (tester) async {
    phone(tester);
    final api = FakeApi({});
    Future<void> noop() async {}
    await tester.pumpWidget(
      host(
        api.client(),
        JobScreen(
          job: DriverJob.fromJson(job(status: 'driver_arrived')),
          onChanged: noop,
        ),
      ),
    );
    final start = find.widgetWithText(FilledButton, 'Vehicle loaded — start tow');
    expect(tester.widget<FilledButton>(start).onPressed, isNull);

    await tester.pumpWidget(
      host(
        api.client(),
        JobScreen(
          job: DriverJob.fromJson(job(status: 'driver_arrived', pickup: 'submitted')),
          onChanged: noop,
        ),
      ),
    );
    expect(tester.widget<FilledButton>(start).onPressed, isNotNull);
    expect(find.text('Pickup inspection — submitted'), findsOneWidget);
  });

  testWidgets('confirms cash for a completed cash job', (tester) async {
    phone(tester);
    final api = FakeApi({
      'POST /drivers/me/jobs/b1/cash-collected': (req) {
        expect(jsonDecode(req.body), {'amountFils': 25328});
        return {'method': 'cash', 'status': 'captured', 'amountFils': 25328};
      },
    });
    await tester.pumpWidget(
      host(api.client(), CompletedJobScreen(job: DriverJob.fromJson(job(status: 'completed')))),
    );
    await tester.tap(find.byKey(const Key('confirm-cash')));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Cash collection recorded'), findsWidgets);
  });
}
