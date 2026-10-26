import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:townow_core/townow_core.dart';
import 'package:townow_customer/screens/completed_screen.dart';
import 'package:townow_customer/screens/home_screen.dart';
import 'package:townow_customer/screens/tracking_screen.dart';

Map<String, dynamic> booking({
  String status = 'driver_arriving',
  bool canCancel = true,
  Map<String, dynamic>? myRating,
}) => {
  'id': 'b1',
  'bookingNumber': 'TN-100400',
  'status': status,
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
  'pickup': {'lat': 25.08, 'lng': 55.14, 'address': 'Dubai Marina'},
  'dropoff': {'lat': 25.12, 'lng': 55.2, 'address': 'Al Quoz garage'},
  'distanceMeters': 9100,
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
  'canCancel': canCancel,
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
  'payment': null,
  'myRating': myRating,
  'history': [
    {'fromStatus': null, 'toStatus': 'requested', 'note': null, 'at': '2026-10-11T10:00:00.000Z'},
  ],
};

class FakeApi {
  FakeApi(this.routes);

  final Map<String, Object? Function(http.Request)> routes;
  final calls = <String>[];

  ApiClient client() => ApiClient(
    baseUrl: 'http://api/api/v1',
    sessions: MemorySessionStore()
      ..current = Session(
        user: AppUser(id: 'u1', phone: '+971501234567', role: 'customer'),
        accessToken: 'a',
        refreshToken: 'r',
      ),
    role: 'customer',
    httpClient: MockClient((req) async {
      final key = '${req.method} ${req.url.path.replaceFirst('/api/v1', '')}';
      calls.add(key);
      final h = routes[key];
      if (h == null) return http.Response('{"message":"not mocked: $key"}', 404);
      return http.Response.bytes(utf8.encode(jsonEncode(h(req))), 200);
    }),
  );
}

void phone(WidgetTester tester) {
  tester.view.physicalSize = const Size(1080, 2600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

Widget host(ApiClient api, Widget child) => AppScope(
  api: api,
  realtime: Realtime(api),
  child: MaterialApp(theme: townowTheme(), home: child),
);

void main() {
  testWidgets('home shows the active tow and the request button', (tester) async {
    phone(tester);
    final api = FakeApi({
      'GET /bookings': (req) {
        expect(req.url.queryParameters['status'], 'active');
        return {
          'items': [booking()],
          'total': 1,
          'page': 1,
          'limit': 50,
        };
      },
    });
    await tester.pumpWidget(host(api.client(), const Scaffold(body: HomeScreen())));
    await tester.pumpAndSettle();
    expect(find.text('TN-100400 · Driver on the way'), findsOneWidget);
    expect(find.byKey(const Key('request-tow')), findsOneWidget);
  });

  testWidgets('tracking shows the driver, an honest ETA, and cancels', (tester) async {
    phone(tester);
    var cancelled = false;
    final api = FakeApi({
      'GET /bookings/b1': (_) => cancelled
          ? {...booking(status: 'cancelled', canCancel: false), 'cancellationReason': 'Car started'}
          : booking(),
      'GET /bookings/b1/driver-location': (_) => {
        'bookingId': 'b1',
        'status': 'driver_arriving',
        'location': {
          'lat': 25.07,
          'lng': 55.13,
          'recordedAt': '2026-10-11T10:05:00Z',
          'ageSeconds': 4,
          'stale': false,
        },
        'eta': {'target': 'pickup', 'status': 'unavailable', 'reason': 'not_configured'},
      },
      'POST /bookings/b1/cancel': (req) {
        expect(jsonDecode(req.body), {'reason': 'Car started'});
        cancelled = true;
        return {
          ...booking(status: 'cancelled', canCancel: false),
          'cancellationReason': 'Car started',
        };
      },
    });
    await tester.pumpWidget(host(api.client(), const TrackingScreen(bookingId: 'b1')));
    await tester.pump();
    await tester.pump();
    expect(find.text('Driver on the way'), findsOneWidget);
    expect(find.textContaining('Hamdan'), findsOneWidget);
    expect(find.text('ETA unavailable'), findsWidgets); // never a made-up number
    expect(find.text('Updated 4s ago'), findsOneWidget);

    await tester.ensureVisible(find.byKey(const Key('cancel')));
    await tester.tap(find.byKey(const Key('cancel')));
    await tester.pump(const Duration(milliseconds: 500)); // status pulse never settles
    await tester.enterText(find.byType(TextField), 'Car started');
    await tester.tap(find.text('Cancel tow').last);
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.text('Cancelled'), findsWidgets);
    expect(find.byKey(const Key('cancel')), findsNothing);
    await tester.pumpWidget(const SizedBox()); // stop the poll timer
  });

  testWidgets('completed tow shows the receipt (not a tax invoice) and rates once', (tester) async {
    phone(tester);
    var rated = false;
    final api = FakeApi({
      'GET /bookings/b1': (_) => booking(
        status: 'completed',
        canCancel: false,
        myRating: rated ? {'rating': 4, 'comment': null, 'ratedAt': '2026-10-11T11:00:00Z'} : null,
      ),
      'GET /bookings/b1/invoice': (_) => {
        'invoiceNumber': 'INV-000016',
        'isTaxInvoice': false,
        'title': 'Receipt',
        'notice':
            'Not a tax invoice: TowNow’s VAT registration number (TRN) is not configured yet.',
        'issuedAt': '2026-10-11T11:00:00Z',
        'bookingNumber': 'TN-100400',
        'seller': {'name': 'TowNow', 'address': null, 'trn': null},
        'customerName': 'Aisha',
        'subtotalFils': 24122,
        'vatRateBps': 500,
        'vatFils': 1206,
        'totalFils': 25328,
        'currency': 'AED',
        'paymentMethod': 'cash',
        'paymentStatus': null,
      },
      'POST /bookings/b1/rating': (req) {
        expect(jsonDecode(req.body), {'rating': 4});
        rated = true;
        return booking(
          status: 'completed',
          myRating: {'rating': 4, 'comment': null, 'ratedAt': '2026-10-11T11:00:00Z'},
        );
      },
    });
    await tester.pumpWidget(host(api.client(), const CompletedScreen(bookingId: 'b1')));
    await tester.pumpAndSettle();
    expect(find.text('Receipt INV-000016'), findsOneWidget);
    expect(find.text('TowNow · TRN not registered'), findsOneWidget);
    expect(find.text('AED 253.28'), findsOneWidget);
    await tester.tap(find.byKey(const Key('star-4')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('submit-rating')));
    await tester.pumpAndSettle();
    expect(find.text('You rated Hamdan 4★'), findsOneWidget);
  });
}
