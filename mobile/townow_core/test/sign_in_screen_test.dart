import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:townow_core/townow_core.dart';

void main() {
  // Regression: a number registered in the other app gets 409 after its code is spent;
  // staying on the code step made the retry say "code has expired or was never requested".
  testWidgets('409 on verify returns to the number step with the real reason', (tester) async {
    final api = ApiClient(
      baseUrl: 'http://api/api/v1',
      sessions: MemorySessionStore(),
      role: 'driver',
      httpClient: MockClient((req) async {
        if (req.url.path.endsWith('/otp/request')) return http.Response('{}', 202);
        return http.Response(
          jsonEncode({'message': 'This number is registered as a customer account.'}),
          409,
        );
      }),
    );
    var signedIn = false;
    await tester.pumpWidget(
      MaterialApp(
        home: SignInScreen(api: api, title: 'Partner', onSignedIn: () => signedIn = true),
      ),
    );

    await tester.enterText(find.byKey(const Key('phone')), '0501234567');
    await tester.tap(find.text('Send code'));
    await tester.pump(const Duration(seconds: 1));
    await tester.enterText(find.byKey(const Key('code')), '123456');
    await tester.tap(find.text('Verify and continue'));
    await tester.pump(const Duration(seconds: 1));
    await tester.pump(const Duration(seconds: 1)); // let the step switcher finish

    expect(signedIn, isFalse);
    expect(find.byKey(const ValueKey('phone-step')), findsOneWidget);
    expect(find.byKey(const ValueKey('code-step')), findsNothing);
    expect(find.text('This number is registered as a customer account.'), findsOneWidget);
  });

  testWidgets('country picker sends the number in the chosen country\'s E.164 form', (
    tester,
  ) async {
    final requested = <String>[];
    final api = ApiClient(
      baseUrl: 'http://api/api/v1',
      sessions: MemorySessionStore(),
      role: 'customer',
      httpClient: MockClient((req) async {
        requested.add((jsonDecode(req.body) as Map<String, dynamic>)['phone'] as String);
        return http.Response('{}', 202);
      }),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: SignInScreen(
          api: api,
          title: 'TowNow',
          onSignedIn: () {},
          countries: const ['AE', 'IN'],
        ),
      ),
    );

    // A UAE number is refused locally once India is picked — no request sent.
    await tester.tap(find.byKey(const Key('country')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('+91').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('phone')), '050 123 4567');
    await tester.tap(find.text('Send code'));
    await tester.pump();
    expect(find.textContaining('Enter a valid India mobile number'), findsOneWidget);
    expect(requested, isEmpty);

    await tester.enterText(find.byKey(const Key('phone')), '98765 43210');
    await tester.tap(find.text('Send code'));
    await tester.pump(const Duration(seconds: 1));
    expect(requested, ['+919876543210']);
    expect(find.text('Sent to +919876543210'), findsOneWidget);
  });

  testWidgets('with one country there is no picker, just the dial code', (tester) async {
    final api = ApiClient(
      baseUrl: 'http://api/api/v1',
      sessions: MemorySessionStore(),
      role: 'driver',
    );
    await tester.pumpWidget(
      MaterialApp(
        home: SignInScreen(api: api, title: 'Partner', onSignedIn: () {}),
      ),
    );
    expect(find.byKey(const Key('country')), findsNothing);
    expect(find.text('+971'), findsOneWidget);
  });
}
