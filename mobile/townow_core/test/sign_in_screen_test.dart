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
}
