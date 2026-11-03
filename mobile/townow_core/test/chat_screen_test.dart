import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:townow_core/townow_core.dart';

Json msg(String id, String body, {bool mine = false, String? clientId, String? readAt}) => {
  'id': id,
  'bookingId': 'b1',
  'clientId': clientId,
  'senderRole': mine ? 'customer' : 'driver',
  'mine': mine,
  'body': body,
  'createdAt': '2026-11-01T10:00:00.000Z',
  'readAt': readAt,
};

Widget host(ApiClient api) => AppScope(
  api: api,
  realtime: Realtime(api),
  child: const MaterialApp(
    home: ChatScreen(bookingId: 'b1', title: 'Chat with Saeed'),
  ),
);

void main() {
  test('client ids are random UUID v4', () {
    final a = newClientId();
    expect(
      a,
      matches(RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')),
    );
    expect(newClientId(), isNot(a));
  });

  testWidgets('shows history, sends, and marks the other side read', (tester) async {
    final posted = <Json>[];
    var reads = 0;
    final api = ApiClient(
      baseUrl: 'http://api/api/v1',
      sessions: MemorySessionStore(),
      role: 'customer',
      httpClient: MockClient((req) async {
        if (req.method == 'GET') {
          return http.Response(
            jsonEncode([
              msg('m1', 'Where are you exactly?'),
              msg('m2', 'By the blue gate', mine: true, readAt: '2026-11-01T10:01:00.000Z'),
            ]),
            200,
          );
        }
        if (req.url.path.endsWith('/read')) {
          reads++;
          return http.Response('{"readAt":"2026-11-01T10:02:00.000Z"}', 200);
        }
        final body = jsonDecode(req.body) as Json;
        posted.add(body);
        return http.Response(
          jsonEncode(
            msg('m3', body['body'] as String, mine: true, clientId: body['clientId'] as String),
          ),
          201,
        );
      }),
    );
    await tester.pumpWidget(host(api));
    await tester.pumpAndSettle();

    expect(find.text('Where are you exactly?'), findsOneWidget);
    expect(find.byIcon(Icons.done_all_rounded), findsOneWidget); // my message was read
    expect(reads, 1); // an unread incoming message → marked read

    await tester.enterText(find.byKey(const Key('chat-input')), '  Coming now  ');
    await tester.tap(find.byKey(const Key('chat-send')));
    await tester.pumpAndSettle();

    expect(posted.single['body'], 'Coming now');
    expect(posted.single['clientId'], isA<String>());
    expect(find.text('Coming now'), findsOneWidget);
    expect(find.byIcon(Icons.done_rounded), findsOneWidget);
  });

  testWidgets('a send that fails offline is kept and retried with the same client id', (
    tester,
  ) async {
    final posted = <Json>[];
    var offline = true;
    final api = ApiClient(
      baseUrl: 'http://api/api/v1',
      sessions: MemorySessionStore(),
      role: 'driver',
      httpClient: MockClient((req) async {
        if (req.method == 'GET') return http.Response('[]', 200);
        final body = jsonDecode(req.body) as Json;
        posted.add(body);
        if (offline) throw http.ClientException('no network');
        return http.Response(
          jsonEncode(
            msg('m9', body['body'] as String, mine: true, clientId: body['clientId'] as String),
          ),
          201,
        );
      }),
    );
    await tester.pumpWidget(host(api));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('chat-input')), 'Arrived');
    await tester.tap(find.byKey(const Key('chat-send')));
    await tester.pumpAndSettle();
    expect(find.text('Not sent · tap to retry'), findsOneWidget);

    offline = false;
    await tester.tap(find.text('Arrived'));
    await tester.pumpAndSettle();

    expect(find.text('Not sent · tap to retry'), findsNothing);
    expect(find.byIcon(Icons.done_rounded), findsOneWidget);
    expect(posted, hasLength(2));
    expect(posted[1]['clientId'], posted[0]['clientId']); // the server stores it once
    expect(find.text('Arrived'), findsOneWidget); // not duplicated
  });

  // Seen on the POCO M3: the job completed while the chat was open; the refused message offered
  // a retry that could never work and the composer stayed open.
  testWidgets('when the job ends while chatting, the screen turns read-only (no futile retry)', (
    tester,
  ) async {
    final api = ApiClient(
      baseUrl: 'http://api/api/v1',
      sessions: MemorySessionStore(),
      role: 'driver',
      httpClient: MockClient((req) async {
        if (req.method == 'GET') return http.Response('[]', 200);
        return http.Response(
          jsonEncode({'message': 'Chat is open while a driver is on the job.'}),
          409,
        );
      }),
    );
    await tester.pumpWidget(host(api));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('chat-input')), 'Test from phone');
    await tester.tap(find.byKey(const Key('chat-send')));
    await tester.pumpAndSettle();

    expect(find.text('Not sent · chat closed'), findsOneWidget);
    expect(find.text('Not sent · tap to retry'), findsNothing);
    expect(find.byKey(const Key('chat-input')), findsNothing);
    expect(find.text('This job is closed, so the chat is read-only.'), findsOneWidget);
  });
}
