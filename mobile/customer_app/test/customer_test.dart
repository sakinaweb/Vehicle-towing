import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:townow_core/townow_core.dart';
import 'package:townow_customer/payments/card_payment.dart';
import 'package:townow_customer/screens/completed_screen.dart';
import 'package:townow_customer/screens/home_screen.dart';
import 'package:townow_customer/screens/payments_screen.dart';
import 'package:townow_customer/screens/request_screen.dart';
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
  // No GPS in tests: the phone reports Location turned off (the manual pickup path).
  setUp(() {
    for (final name in [
      'flutter.baseflow.com/geolocator',
      'flutter.baseflow.com/geolocator_android',
    ]) {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
        MethodChannel(name),
        (call) async => call.method == 'isLocationServiceEnabled' ? false : null,
      );
    }
  });

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

  testWidgets('books in a few taps: saved vehicle, pinned pickup, recent destination', (
    tester,
  ) async {
    phone(tester);
    Map<String, dynamic>? quoted;
    var booked = 0;
    final api = FakeApi({
      'GET /customers/me/vehicles': (_) => [booking()['vehicle']],
      'GET /bookings': (_) => {
        'items': [booking(status: 'completed', canCancel: false)],
        'total': 1,
        'page': 1,
        'limit': 50,
      },
      'GET /availability/nearby': (_) => {'total': 0, 'byTowType': <String, dynamic>{}},
      'POST /bookings/quotes': (req) {
        quoted = jsonDecode(req.body) as Map<String, dynamic>;
        return {
          'quoteId': 'q1',
          'expiresAt': DateTime.now().add(const Duration(minutes: 15)).toIso8601String(),
          'vehicleId': 'v1',
          'towType': quoted!['towType'],
          'pickup': quoted!['pickup'],
          'dropoff': quoted!['dropoff'],
          'distanceMeters': 9100,
          'estimatedDurationSeconds': 900,
          'distanceSource': 'straight_line',
          'fare': booking()['fare'],
        };
      },
      'POST /bookings': (req) {
        booked++;
        expect(jsonDecode(req.body), {
          'quoteId': 'q1',
          'issue': 'Breakdown',
          'paymentMethod': 'cash',
        });
        return booking(status: 'requested');
      },
      'GET /bookings/b1': (_) => booking(status: 'requested'),
      'GET /bookings/b1/driver-location': (_) => {
        'bookingId': 'b1',
        'status': 'requested',
        'location': null,
        'eta': {'target': 'pickup', 'status': 'unavailable', 'reason': 'no_driver'},
      },
    });
    await tester.pumpWidget(host(api.client(), const RequestScreen()));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    // Saved vehicle preselected; no GPS in tests → manual pickup is offered.
    expect(find.textContaining('pin your pickup'), findsOneWidget);
    expect(find.byIcon(Icons.check_circle_rounded), findsOneWidget);

    await tester.tap(find.byKey(const Key('use-location')));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    await tester.tap(find.byKey(const Key('pickup-map')));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    await tester.enterText(find.byKey(const Key('pin-lat')), '25.08');
    await tester.enterText(find.byKey(const Key('pin-lng')), '55.14');
    await tester.pump();
    await tester.tap(find.byKey(const Key('use-point')));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    await tester.ensureVisible(find.byKey(const Key('recent-0')));
    await tester.tap(find.byKey(const Key('recent-0')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(quoted!['towType'], 'flatbed');
    expect(quoted!['vehicleId'], 'v1');
    expect(quoted!['pickup'], {
      'lat': 25.08,
      'lng': 55.14,
      'address': 'Map pin 25.08000, 55.14000',
    });
    expect(quoted!['dropoff'], {'lat': 25.12, 'lng': 55.2, 'address': 'Al Quoz garage'});
    expect(find.text('VAT 5.0%'), findsOneWidget);
    expect(find.text('Confirm booking · AED 253.28'), findsOneWidget);

    // A double tap books once.
    await tester.tap(find.byKey(const Key('book')));
    await tester.tap(find.byKey(const Key('book')), warnIfMissed: false);
    await tester.pump();
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(booked, 1);
    expect(find.text('TN-100400'), findsOneWidget); // tracking screen title
    await tester.pumpWidget(const SizedBox()); // stop map / poll timers
  });

  testWidgets('destination search shows results while typing; one tap picks one', (tester) async {
    phone(tester);
    final queries = <String>[];
    final api = FakeApi({
      'GET /customers/me/vehicles': (_) => [booking()['vehicle']],
      'GET /bookings': (_) => {'items': <Object>[], 'total': 0, 'page': 1, 'limit': 50},
      'GET /locations/search': (req) {
        queries.add(req.url.queryParameters['q']!);
        return {
          'status': 'available',
          'results': [
            {'lat': 25.13, 'lng': 55.22, 'address': 'Al Quoz Industrial Area 3, Dubai'},
          ],
        };
      },
    });
    await tester.pumpWidget(host(api.client(), const RequestScreen()));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    await tester.tap(find.byKey(const Key('search-destination')));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    await tester.enterText(find.byKey(const Key('place-search')), 'Al');
    await tester.pump(const Duration(seconds: 1));
    expect(queries, isEmpty); // under 3 letters: no request
    await tester.enterText(find.byKey(const Key('place-search')), 'Al Qu');
    await tester.enterText(find.byKey(const Key('place-search')), 'Al Quoz');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump();
    expect(queries, ['Al Quoz']); // debounced: only the last text is searched
    expect(find.byKey(const Key('search-pin')), findsOneWidget);

    await tester.tap(find.byKey(const Key('place-0')));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Al Quoz Industrial Area 3, Dubai'), findsWidgets);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('a failing quote shows the error with retry and blocks booking', (tester) async {
    phone(tester);
    final api = FakeApi({
      'GET /customers/me/vehicles': (_) => [booking()['vehicle']],
      'GET /bookings': (_) => {
        'items': [booking(status: 'completed', canCancel: false)],
        'total': 1,
        'page': 1,
        'limit': 50,
      },
      // POST /bookings/quotes not mocked → the API answers with an error.
    });
    await tester.pumpWidget(host(api.client(), const RequestScreen()));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.byKey(const Key('use-location')));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    await tester.tap(find.byKey(const Key('pickup-map')));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    await tester.enterText(find.byKey(const Key('pin-lat')), '25.08');
    await tester.enterText(find.byKey(const Key('pin-lng')), '55.14');
    await tester.pump();
    await tester.tap(find.byKey(const Key('use-point')));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    await tester.ensureVisible(find.byKey(const Key('recent-0')));
    await tester.tap(find.byKey(const Key('recent-0')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.textContaining('not mocked: POST /bookings/quotes'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
    final book = tester.widget<TnButton>(find.byKey(const Key('book')));
    expect(book.onPressed, isNull);
    await tester.pumpWidget(const SizedBox());
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

  testWidgets('payments & receipts: only tows with a payment, real totals incl. VAT', (
    tester,
  ) async {
    Map<String, dynamic> paid(String id, String number, String method, String status) => {
      ...booking(status: 'completed', canCancel: false),
      'id': id,
      'bookingNumber': number,
      'payment': {'method': method, 'status': status, 'amountFils': 25328},
    };
    final api = ApiClient(
      baseUrl: 'http://api/api/v1',
      sessions: MemorySessionStore(),
      role: 'customer',
      httpClient: MockClient(
        (req) async => http.Response(
          jsonEncode({
            'items': [
              paid('p1', 'TN-100501', 'cash', 'captured'),
              paid('p2', 'TN-100502', 'card', 'captured'),
              paid('p3', 'TN-100503', 'card', 'refunded'),
              {
                ...booking(status: 'searching'),
                'id': 'n1',
                'bookingNumber': 'TN-100599',
              }, // no payment
            ],
          }),
          200,
        ),
      ),
    );
    await tester.pumpWidget(host(api, const PaymentsScreen()));
    await tester.pumpAndSettle();

    expect(find.text('TN-100501'), findsOneWidget);
    expect(find.text('TN-100503'), findsOneWidget);
    expect(find.text('TN-100599'), findsNothing); // no payment → not listed
    expect(find.textContaining('Refunded'), findsOneWidget);
    expect(find.text('2 paid tows'), findsOneWidget); // the refunded one does not count
    expect(find.text('AED 24.12'), findsOneWidget); // VAT: 2 × 12.06
    expect(find.textContaining('Cash ·'), findsOneWidget);
  });

  group('card payments (Stripe test mode)', () {
    final sheetCalls = <PaymentSession>[];
    var nextSheet = const SheetOutcome(SheetResult.completed);
    setUp(() {
      sheetCalls.clear();
      nextSheet = const SheetOutcome(SheetResult.completed);
      cardSheet = (s) async {
        sheetCalls.add(s);
        return nextSheet;
      };
    });

    Map<String, dynamic> cardBooking(String paymentStatus, {String status = 'requested'}) => {
      ...booking(status: status),
      'paymentMethod': 'card',
      'driver': null,
      'payment': {
        'method': 'card',
        'status': paymentStatus,
        'amountFils': 25328,
        'failureReason': paymentStatus == 'failed' ? 'Your card was declined.' : null,
      },
    };
    Map<String, dynamic> session({String key = 'pk_test_abc'}) => {
      'status': 'pending',
      'amountFils': 25328,
      'currency': 'AED',
      'provider': 'stripe',
      'clientSecret': 'pi_1_secret_x',
      'publishableKey': key,
    };
    Map<String, dynamic> summary(String status) => {
      'id': 'p1',
      'method': 'card',
      'status': status,
      'amountFils': 25328,
      'failureReason': status == 'failed' ? 'Your card was declined.' : null,
    };
    Map<String, Object? Function(http.Request)> noDriver() => {
      'GET /bookings/b1/driver-location': (_) => {
        'bookingId': 'b1',
        'status': 'requested',
        'location': null,
        'eta': {'target': 'pickup', 'status': 'unavailable', 'reason': 'no_driver'},
      },
    };
    Future<void> settle(WidgetTester tester) async {
      for (var i = 0; i < 4; i++) {
        await tester.pump(const Duration(milliseconds: 300));
      }
    }

    testWidgets(
      'card is offered only when the server accepts it; booking with card opens the form',
      (tester) async {
        phone(tester);
        var paid = false;
        Map<String, dynamic>? booked;
        final api = FakeApi({
          ...noDriver(),
          'GET /payments/methods': (_) => {
            'methods': ['cash', 'card', 'apple_pay'],
          },
          'GET /customers/me/vehicles': (_) => [booking()['vehicle']],
          'GET /bookings': (_) => {
            'items': [booking(status: 'completed', canCancel: false)],
            'total': 1,
            'page': 1,
            'limit': 50,
          },
          'GET /availability/nearby': (_) => {'total': 0, 'byTowType': <String, dynamic>{}},
          'POST /bookings/quotes': (req) {
            final q = jsonDecode(req.body) as Map<String, dynamic>;
            return {
              'quoteId': 'q1',
              'expiresAt': DateTime.now().add(const Duration(minutes: 15)).toIso8601String(),
              'vehicleId': 'v1',
              'towType': q['towType'],
              'pickup': q['pickup'],
              'dropoff': q['dropoff'],
              'distanceMeters': 9100,
              'estimatedDurationSeconds': 900,
              'distanceSource': 'straight_line',
              'fare': booking()['fare'],
            };
          },
          'POST /bookings': (req) {
            booked = jsonDecode(req.body) as Map<String, dynamic>;
            return cardBooking('pending');
          },
          'GET /bookings/b1': (_) =>
              paid ? cardBooking('authorized', status: 'searching') : cardBooking('pending'),
          'POST /bookings/b1/payment': (_) => session(),
          'POST /bookings/b1/payment/sync': (_) {
            paid = true;
            return summary('authorized');
          },
        });
        await tester.pumpWidget(host(api.client(), const RequestScreen()));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        await tester.tap(find.byKey(const Key('use-location')));
        await tester.pump();
        await tester.pump(const Duration(seconds: 1));
        await tester.tap(find.byKey(const Key('pickup-map')));
        await tester.pump();
        await tester.pump(const Duration(seconds: 1));
        await tester.enterText(find.byKey(const Key('pin-lat')), '25.08');
        await tester.enterText(find.byKey(const Key('pin-lng')), '55.14');
        await tester.pump();
        await tester.tap(find.byKey(const Key('use-point')));
        await tester.pump();
        await tester.pump(const Duration(seconds: 1));
        await tester.ensureVisible(find.byKey(const Key('recent-0')));
        await tester.tap(find.byKey(const Key('recent-0')));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        // Cash stays the default; card is a choice.
        expect(find.text('Cash on delivery'), findsNothing);
        final cash = tester.widget<ChoiceChip>(find.byKey(const Key('pay-cash')));
        expect(cash.selected, isTrue);
        await tester.ensureVisible(find.byKey(const Key('pay-card')));
        await tester.tap(find.byKey(const Key('pay-card')));
        await tester.pump();
        expect(find.text('Your card is held now and charged only after delivery'), findsOneWidget);

        await tester.ensureVisible(find.byKey(const Key('book')));
        await tester.tap(find.byKey(const Key('book')));
        await settle(tester);
        await settle(tester);

        expect(booked, {'quoteId': 'q1', 'issue': 'Breakdown', 'paymentMethod': 'card'});
        expect(sheetCalls, hasLength(1)); // opened straight away
        expect(sheetCalls.single.clientSecret, 'pi_1_secret_x');
        expect(sheetCalls.single.publishableKey, 'pk_test_abc');
        expect(find.text('Card authorised — you are charged after delivery.'), findsOneWidget);
        expect(find.textContaining('Card · held, charged after delivery'), findsOneWidget);
        expect(find.byKey(const Key('pay-now')), findsNothing);
        await tester.pumpWidget(const SizedBox());
      },
    );

    testWidgets('closing the form keeps Pay now; a decline shows the reason and Try again', (
      tester,
    ) async {
      phone(tester);
      var status = 'pending';
      final api = FakeApi({
        ...noDriver(),
        'GET /bookings/b1': (_) => cardBooking(status),
        'POST /bookings/b1/payment': (_) => session(),
        'POST /bookings/b1/payment/sync': (_) => summary(status),
      });
      await tester.pumpWidget(host(api.client(), const TrackingScreen(bookingId: 'b1')));
      await settle(tester);
      expect(sheetCalls, isEmpty); // not opened by itself when just viewing the tow
      expect(find.text('Complete your card payment'), findsOneWidget);
      expect(find.textContaining('Complete the card payment'), findsWidgets);

      nextSheet = const SheetOutcome(SheetResult.closed);
      await tester.tap(find.byKey(const Key('pay-now')));
      await settle(tester);
      expect(sheetCalls, hasLength(1));
      expect(find.text('Payment not completed. Tap Pay now when you are ready.'), findsOneWidget);
      expect(find.byKey(const Key('pay-now')), findsOneWidget);

      nextSheet = const SheetOutcome(SheetResult.failed, 'Your card was declined.');
      status = 'failed';
      await tester.tap(find.byKey(const Key('pay-now')));
      await settle(tester);
      expect(sheetCalls, hasLength(2));
      expect(find.text('Card payment failed'), findsOneWidget);
      expect(find.text('Your card was declined.'), findsWidgets);
      expect(find.text('Try again · AED 253.28'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('a live publishable key is refused in this build', (tester) async {
      phone(tester);
      final api = FakeApi({
        ...noDriver(),
        'GET /bookings/b1': (_) => cardBooking('pending'),
        'POST /bookings/b1/payment': (_) => session(key: 'pk_live_abc'),
      });
      await tester.pumpWidget(host(api.client(), const TrackingScreen(bookingId: 'b1')));
      await settle(tester);
      await tester.tap(find.byKey(const Key('pay-now')));
      await settle(tester);
      expect(sheetCalls, isEmpty);
      expect(find.text('Card payments are in test mode only.'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('cash tow still says cash and never shows Pay now', (tester) async {
      phone(tester);
      final api = FakeApi({
        ...noDriver(),
        'GET /bookings/b1': (_) => {...booking(status: 'requested'), 'driver': null},
      });
      await tester.pumpWidget(host(api.client(), const TrackingScreen(bookingId: 'b1')));
      await settle(tester);
      expect(find.textContaining('Cash to the driver'), findsOneWidget);
      expect(find.byKey(const Key('pay-now')), findsNothing);
      expect(api.calls, isNot(contains('POST /bookings/b1/payment')));
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('card receipt shows Card and Paid', (tester) async {
      phone(tester);
      final api = FakeApi({
        'GET /bookings/b1': (_) => cardBooking('captured', status: 'completed'),
        'GET /bookings/b1/invoice': (_) => {
          'invoiceNumber': 'INV-000017',
          'isTaxInvoice': false,
          'title': 'Receipt',
          'notice': null,
          'issuedAt': '2026-10-11T11:00:00Z',
          'bookingNumber': 'TN-100400',
          'seller': {'name': 'TowNow', 'address': null, 'trn': null},
          'customerName': 'Aisha',
          'subtotalFils': 24122,
          'vatRateBps': 500,
          'vatFils': 1206,
          'totalFils': 25328,
          'currency': 'AED',
          'paymentMethod': 'card',
          'paymentStatus': 'captured',
        },
      });
      await tester.pumpWidget(host(api.client(), const CompletedScreen(bookingId: 'b1')));
      await tester.pumpAndSettle();
      expect(find.text('Payment: Card'), findsOneWidget);
      expect(find.text('Paid'), findsOneWidget);
    });
  });
}
